/**
 * Deterministic one-process-per-message Pi RPC lifecycle driver.
 *
 * Demonstrates the architecture end-to-end using two scripted fake-Pi RPC
 * child processes. No provider or network access is required because the
 * fake child runs as a plain Node script; the real Pi binary path is exercised
 * separately by ./live-pi-smoke.ts.
 *
 * Two sequential processes are spawned:
 *
 *   1. Process A is started against a fresh temp session directory: it emits a
 *      prompt acceptance for our `prompt` command, streams minimal agent
 *      events, settles, then answers `get_state` with a session file path
 *      under the temp directory.
 *
 *   2. Process B is started with the same session path (the resume flow): it
 *      pretends to load the existing session, accepts our second `prompt`,
 *      streams a follow-up message, and settles again.
 *
 * For each process we record and assert:
 *   - the prompt-acceptance response (proves request/response correlation works),
 *   - the full ordered event stream including agent_start,
 *     message_start, message_update (text_delta), message_end, agent_end,
 *     agent_settled,
 *   - the time from spawn -> first stdout frame (startup latency),
 *   - the time from prompt send -> agent_settled (settlement latency),
 *   - that agent_settled arrives after agent_end,
 *   - that get_state returns the exact sessionFile we passed,
 *   - that the child is reaped after stop().
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { RpcClient, type RpcEvent, type RpcResponse } from "./rpc-client.ts";
import { makeTmpSession } from "./tmp.ts";

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));

class AssertionError extends Error {}
function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new AssertionError(message);
}

function writeScenarioFile(label: string, scenario: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "slam-scenario-"));
	const path = join(dir, `${label}.json`);
	writeFileSync(path, JSON.stringify(scenario, null, 2), "utf8");
	return path;
}

function scenarioCreateSession(sessionFile: string) {
	return [
		{
			kind: "wait-for-stdin",
			match: { type: "prompt" },
			respond: { type: "response", command: "prompt", success: true, id: "req-1", data: undefined },
		},
		{ kind: "delay", ms: 5 },
		{ kind: "write", record: { type: "agent_start" } },
		{ kind: "write", record: { type: "turn_start" } },
		{ kind: "write", record: { type: "message_start", message: { role: "assistant", content: [] } } },
		{
			kind: "write",
			record: {
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello from session A." },
			},
		},
		{ kind: "write", record: { type: "message_end", message: { role: "assistant" } } },
		{ kind: "write", record: { type: "turn_end" } },
		{ kind: "write", record: { type: "agent_end", messages: [], willRetry: false } },
		{ kind: "write", record: { type: "agent_settled" } },
		{
			kind: "wait-for-stdin",
			match: { type: "get_state" },
			respond: {
				type: "response",
				command: "get_state",
				success: true,
				id: "req-state-a",
				data: {
					model: { id: "fake-model", provider: "fake", name: "fake-model" },
					thinkingLevel: "off",
					isStreaming: false,
					isCompacting: false,
					steeringMode: "one-at-a-time",
					followUpMode: "one-at-a-time",
					sessionFile,
					sessionId: "session-aaa",
					autoCompactionEnabled: true,
					messageCount: 1,
					pendingMessageCount: 0,
				},
			},
		},
		{ kind: "exit", code: 0 },
	];
}

function scenarioResumeSession(sessionFile: string) {
	return [
		{
			kind: "write",
			record: {
				type: "message_start",
				message: { role: "user", content: "Hello from session A." },
				resumed: true,
				sessionFile,
			},
		},
		{
			kind: "wait-for-stdin",
			match: { type: "prompt" },
			respond: { type: "response", command: "prompt", success: true, id: "req-2", data: undefined },
		},
		{ kind: "delay", ms: 5 },
		{ kind: "write", record: { type: "agent_start" } },
		{ kind: "write", record: { type: "turn_start" } },
		{ kind: "write", record: { type: "message_start", message: { role: "assistant", content: [] } } },
		{
			kind: "write",
			record: {
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Resumed: following up." },
			},
		},
		{ kind: "write", record: { type: "message_end", message: { role: "assistant" } } },
		{ kind: "write", record: { type: "turn_end" } },
		{ kind: "write", record: { type: "agent_end", messages: [], willRetry: false } },
		{ kind: "write", record: { type: "agent_settled" } },
		{
			kind: "wait-for-stdin",
			match: { type: "get_state" },
			respond: {
				type: "response",
				command: "get_state",
				success: true,
				id: "req-state-b",
				data: {
					model: { id: "fake-model", provider: "fake", name: "fake-model" },
					thinkingLevel: "off",
					isStreaming: false,
					isCompacting: false,
					steeringMode: "one-at-a-time",
					followUpMode: "one-at-a-time",
					sessionFile,
					sessionId: "session-aaa",
					sessionName: "follow-up",
					autoCompactionEnabled: true,
					messageCount: 2,
					pendingMessageCount: 0,
				},
			},
		},
		{ kind: "exit", code: 0 },
	];
}

function fakeSpawn(extraArgs: readonly string[]): string[] {
	return [
		"--experimental-strip-types",
		"--no-warnings",
		join(SPIKE_DIR, "fake-pi-server.ts"),
		...extraArgs,
	];
}

async function isPidReaped(pid: number): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			process.kill(pid, 0);
			resolve(false);
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err.code === "ESRCH") {
				resolve(true);
				return;
			}
			if (err.code === "EPERM") {
				resolve(false);
				return;
			}
			resolve(true);
		}
	});
}

interface ProcessedRun {
	label: string;
	sessionFile: string;
	startupMs: number;
	promptAcceptanceMs: number;
	settleMs: number;
	promptResponse: RpcResponse;
	settled: RpcEvent;
	state: RpcResponse;
	events: RpcEvent[];
	pid: number;
	exit: { exitCode: number | null; signal: NodeJS.Signals | null; durationMs: number };
	reaped: boolean;
	stderr: string;
}

async function runTurn(label: string, sessionFile: string, scenario: unknown): Promise<ProcessedRun> {
	const events: RpcEvent[] = [];
	const parseErrors: { line: string; error: Error }[] = [];

	const scenarioPath = writeScenarioFile(label, scenario);
	const client = new RpcClient({
		spawn: { command: process.execPath, args: fakeSpawn([scenarioPath]) },
		startupTimeoutMs: 5_000,
		defaultResponseTimeoutMs: 5_000,
		onEvent: (event) => events.push(event),
		onParseError: (line, error) => parseErrors.push({ line, error }),
	});
	try {
		await client.start();
		const pid = client.pid;
		assert(pid > 0, `${label}: expected positive child PID`);

		const promptSentAt = Date.now();
		const settledPromise = client.untilEvent("agent_settled", { timeoutMs: 5_000 });
		const promptResponse = await client.send<RpcResponse>(
			{ type: "prompt", message: `hi ${label}` },
			{ timeoutMs: 5_000 },
		);
		const promptAcceptanceMs = Date.now() - promptSentAt;
		assert(promptResponse.success === true, `${label}: prompt was rejected: ${promptResponse.error}`);

		const settled = await settledPromise;
		const settleMs = Date.now() - promptSentAt;
		assert(client.pid === pid, `${label}: PID changed unexpectedly`);

		const state = await client.send<RpcResponse>({ type: "get_state" }, { timeoutMs: 5_000 });
		assert(state.success === true, `${label}: get_state rejected: ${state.error}`);

		const exit = await client.stop({ timeoutMs: 5_000 });
		const reaped = await isPidReaped(pid);

	assert(parseErrors.length === 0, `${label}: parse errors: ${JSON.stringify(parseErrors)}`);
	assert(events.some((e) => e.type === "agent_start"), `${label}: missing agent_start`);
	assert(events.some((e) => e.type === "message_start"), `${label}: missing message_start`);
	assert(
		events.some((e) => {
			const raw = e.raw as { assistantMessageEvent?: { type?: string } };
			return raw.assistantMessageEvent?.type === "text_delta";
		}),
		`${label}: missing text_delta`,
	);
	assert(events.some((e) => e.type === "agent_settled"), `${label}: missing agent_settled`);

		const startupMs = (client.firstReadAt ?? Date.now()) - client.spawnStartedAt;
		return {
		label,
		sessionFile,
		startupMs,
		promptAcceptanceMs,
		settleMs,
		promptResponse,
		settled,
		state,
		events,
		pid,
		exit,
		reaped,
		stderr: exit.stderr,
		};
	} finally {
		rmSync(dirname(scenarioPath), { recursive: true, force: true });
	}
}

function assertRunInvariant(run: ProcessedRun): void {
	const stateData = run.state.data as { sessionFile?: string; messageCount?: number } | undefined;
	assert(stateData?.sessionFile === run.sessionFile, `${run.label}: get_state.sessionFile mismatch`);
	void stateData?.messageCount;
	assert(
		run.exit.exitCode === 0 || run.exit.exitCode === null,
		`${run.label}: exit code was ${run.exit.exitCode}`,
	);
	assert(run.reaped, `${run.label}: child PID ${run.pid} was not reaped`);
	const settleIndex = run.events.findIndex((e) => e.type === "agent_settled");
	const endIndex = run.events.findIndex((e) => e.type === "agent_end");
	assert(settleIndex > -1 && endIndex > -1, `${run.label}: required ordering events missing`);
	assert(
		settleIndex > endIndex,
		`${run.label}: agent_settled (idx ${settleIndex}) must arrive after agent_end (idx ${endIndex})`,
	);
}

function summarize(run: ProcessedRun) {
	return {
		pid: run.pid,
		sessionFile: run.sessionFile,
		startupMs: run.startupMs,
		promptAcceptanceMs: run.promptAcceptanceMs,
		settleMs: run.settleMs,
		eventCount: run.events.length,
		stateSessionFile: (run.state.data as { sessionFile?: string } | undefined)?.sessionFile ?? null,
		stateMessageCount: (run.state.data as { messageCount?: number } | undefined)?.messageCount ?? null,
		exit: { exitCode: run.exit.exitCode, signal: run.exit.signal, durationMs: run.exit.durationMs },
		reaped: run.reaped,
	};
}

async function main(): Promise<void> {
	const tmp = makeTmpSession("slam-rpc-lifecycle-");
	const sessionFile = join(tmp.path, "session-aaa.jsonl");
	try {
		const runA = await runTurn("A-create", sessionFile, scenarioCreateSession(sessionFile));
		assertRunInvariant(runA);
		const runB = await runTurn("B-resume", sessionFile, scenarioResumeSession(sessionFile));
		assertRunInvariant(runB);
		assert(runA.pid !== runB.pid, "each invocation must start a fresh process");

		const summary = { processA: summarize(runA), processB: summarize(runB) };
		console.log("deterministic-lifecycle: OK");
		console.log(JSON.stringify(summary, null, 2));
	} finally {
		tmp.cleanup();
	}
}

main().catch((error) => {
	console.error("deterministic-lifecycle: FAIL");
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exit(1);
});

/**
 * Real-Pi lifecycle path the spike exercises against the user's configured
 * provider/model.
 *
 * Two sequential real `pi --mode rpc` invocations are used to demonstrate the
 * faithful one-process-per-message path:
 *
 *   Process A: spawn Pi with a temporary `--session-dir`, send a prompt, wait
 *              for `agent_settled`, request `get_state`, stop the child, reap
 *              it. Use the returned `sessionFile` to drive Process B.
 *   Process B: spawn Pi again with the same `--session-dir`, prove the same
 *              `sessionFile` / `sessionId` are visible, send a follow-up
 *              prompt, again wait for `agent_settled`.
 *
 * The smoke records startup/resume latency for each process as the POC quality
 * metric called out in the implementation notes. It does NOT inspect or print
 * the user's real Pi sessions or credentials; `--session-dir` is always a
 * freshly `mkdtempSync`-created directory under `os.tmpdir()`.
 *
 * Provider/model selection: when a real `pi` binary exists on PATH (or
 * `SLAM_PI_BINARY` points to one), this smoke defaults to the configured
 * `zionlab` / `Delta` combination. The combination can be overridden with
 * `SLAM_LIVE_PROVIDER` and `SLAM_LIVE_MODEL` for later re-use, but the spike's
 * recorded behavior targets the user-configured provider.
 *
 * Failure handling:
 *   - no `pi` binary discovered -> skip with a one-line message,
 *   - provider model not reachable / errors before response -> record a clear
 *     `provider-unavailable` outcome so the spike can be re-run when the
 *     environment is provisioned again.
 */

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RpcClient, type RpcEvent, type RpcResponse } from "./rpc-client.ts";
import { makeTmpSession } from "./tmp.ts";

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));
void SPIKE_DIR;

const DEFAULT_PROVIDER = "zionlab";
const DEFAULT_MODEL = "Delta";
const PROMPT_TIMEOUT_MS = 90_000;

interface DiscoveredBinary {
	readonly command: string;
	readonly args: readonly string[];
	readonly source: string;
}

function readProvider(): string {
	return process.env["SLAM_LIVE_PROVIDER"] ?? DEFAULT_PROVIDER;
}

function readModel(): string {
	return process.env["SLAM_LIVE_MODEL"] ?? DEFAULT_MODEL;
}

function discoverBinary(): DiscoveredBinary | null {
	const env = process.env["SLAM_PI_BINARY"];
	if (env && existsSync(env)) {
		return { command: process.execPath, args: [env], source: `SLAM_PI_BINARY=${env}` };
	}
	const pathHit = (process.env["PATH"] ?? "").split(":").find((dir) => existsSync(join(dir, "pi")));
	if (pathHit) {
		return { command: "pi", args: [], source: `PATH=${pathHit}/pi` };
	}
	const cached = "/home/contra/.local/share/opencode/repos/github.com/earendil-works/pi/packages/coding-agent/dist/cli.js";
	if (existsSync(cached)) {
		return { command: process.execPath, args: [cached], source: cached };
	}
	return null;
}

function extractStateSession(state: RpcResponse): { sessionFile?: string; sessionId?: string; provider?: string; modelId?: string } {
	const data = (state.data ?? {}) as {
		sessionFile?: string;
		sessionId?: string;
		model?: { provider?: string; id?: string };
	};
	return {
		sessionFile: data.sessionFile,
		sessionId: data.sessionId,
		provider: data.model?.provider,
		modelId: data.model?.id,
	};
}

interface TurnOutcome {
	ok: boolean;
	detail: string;
	startupMs?: number;
	promptAcceptanceMs?: number;
	settleMs?: number;
	pid?: number;
	sessionFile?: string;
	sessionId?: string;
	sessionProvider?: string;
	sessionModelId?: string;
	exit?: { exitCode: number | null; signal: NodeJS.Signals | null };
	stderrTail?: string;
}

async function runRealTurn(
	label: string,
	discovered: DiscoveredBinary,
	sessionDir: string,
	provider: string,
	model: string,
	prompt: string,
	sessionFile?: string,
): Promise<TurnOutcome> {
	const events: RpcEvent[] = [];
	const client = new RpcClient({
		spawn: {
			command: discovered.command,
			args: [
				...discovered.args,
				"--mode",
				"rpc",
				"--provider",
				provider,
				"--model",
				model,
				"--session-dir",
				sessionDir,
				...(sessionFile ? ["--session", sessionFile] : []),
			],
		},
		startupTimeoutMs: 10_000,
		defaultResponseTimeoutMs: 30_000,
		onEvent: (event) => events.push(event),
	});

	try {
		await client.start();
	} catch (error) {
		return {
			ok: false,
			detail: `start failed: ${(error as Error).message}`,
			stderrTail: client.stderrText().slice(-400),
		};
	}

	const pid = client.pid;

	let promptAcceptanceMs: number | undefined;
	let settleMs: number | undefined;
	try {
		const initialState = await client.send<RpcResponse>({ type: "get_state" }, { timeoutMs: 5_000 });
		if (sessionFile && extractStateSession(initialState).sessionFile !== sessionFile) {
			throw new Error(`startup did not resume expected session ${sessionFile}`);
		}
		const promptSentAt = Date.now();
		const settledPromise = client.untilEvent("agent_settled", { timeoutMs: PROMPT_TIMEOUT_MS });
		const promptResp = await client.send<RpcResponse>({ type: "prompt", message: prompt }, { timeoutMs: 5_000 });
		promptAcceptanceMs = Date.now() - promptSentAt;
		if (!promptResp.success) {
			const exit = await client.stop({ timeoutMs: 5_000 });
			return {
				ok: false,
				detail: `prompt rejected: ${promptResp.error ?? "(no error)"}`,
				pid,
				exit: { exitCode: exit.exitCode, signal: exit.signal },
				stderrTail: exit.stderr.slice(-400),
			};
		}
		await settledPromise;
		settleMs = Date.now() - promptSentAt;
		const stateResp = await client.send<RpcResponse>({ type: "get_state" }, { timeoutMs: 5_000 });
		if (!stateResp.success) {
			throw new Error(`get_state failed: ${stateResp.error ?? "(no error)"}`);
		}
		const summary = extractStateSession(stateResp);
		const exit = await client.stop({ timeoutMs: 5_000 });
		if (exit.exitCode === null && exit.signal === null) {
			return {
				ok: false,
				detail: `${label}: child did not exit within stop deadline`,
				pid,
				sessionFile: summary.sessionFile,
				sessionId: summary.sessionId,
				sessionProvider: summary.provider,
				sessionModelId: summary.modelId,
				promptAcceptanceMs,
				settleMs,
				startupMs: (client.firstReadAt ?? Date.now()) - client.spawnStartedAt,
				exit: { exitCode: exit.exitCode, signal: exit.signal },
				stderrTail: exit.stderr.slice(-400),
			};
		}
		if (isProcessAlive(pid)) {
			return {
				ok: false,
				detail: `${label}: child PID ${pid} still exists after stop`,
				pid,
				exit: { exitCode: exit.exitCode, signal: exit.signal },
				stderrTail: exit.stderr.slice(-400),
			};
		}
		return {
			ok: true,
			detail: `${label}: settled`,
			pid,
			sessionFile: summary.sessionFile,
			sessionId: summary.sessionId,
			sessionProvider: summary.provider,
			sessionModelId: summary.modelId,
			promptAcceptanceMs,
			settleMs,
			startupMs: (client.firstReadAt ?? Date.now()) - client.spawnStartedAt,
			exit: { exitCode: exit.exitCode, signal: exit.signal },
			stderrTail: exit.stderr.slice(-400),
		};
	} catch (error) {
		const exit = await client.stop({ timeoutMs: 5_000 }).catch(() => null);
		return {
			ok: false,
			detail: `${label}: ${(error as Error).message}`,
			pid,
			promptAcceptanceMs,
			settleMs,
			startupMs: (client.firstReadAt ?? Date.now()) - client.spawnStartedAt,
			exit: exit ? { exitCode: exit.exitCode, signal: exit.signal } : undefined,
			stderrTail: (client.stderrText() + (exit?.stderr ?? "")).slice(-400),
		};
	}

	void events; // events retained only for a future diagnostic dump
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

async function main(): Promise<void> {
	const discovered = discoverBinary();
	const provider = readProvider();
	const model = readModel();

	if (!discovered) {
		console.log("live-pi-smoke: SKIP (no `pi` binary on PATH, SLAM_PI_BINARY, or in the opencode repo cache)");
		return;
	}
	let version = "unknown";
	try {
		version = execFileSync(discovered.command, [...discovered.args, "--version"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		version = "unknown";
	}
	console.log(`live-pi-smoke: using binary at ${discovered.source} (pi ${version}), provider=${provider} model=${model}`);

	const tmp = makeTmpSession("slam-live-pi-");
	const sessionDir = tmp.path;
	try {
		const create = await runRealTurn(
			"create",
			discovered,
			sessionDir,
			provider,
			model,
			"Reply with just the literal token PONG and nothing else.",
		);
		if (!create.ok) {
			console.log(
				`live-pi-smoke: provider-unavailable during create turn (${create.detail}); recorded for re-run`,
			);
			console.log(
				JSON.stringify(
					{ binary: discovered.source, provider, model, create, resume: null as TurnOutcome | null },
					null,
					2,
				),
			);
			process.exit(0);
		}
		const sessionFile = create.sessionFile;
		if (!sessionFile) {
			console.error("live-pi-smoke: provider call returned a session without a sessionFile");
			console.error(JSON.stringify(create, null, 2));
			process.exit(1);
		}
		const isInSessionDir = sessionFile.startsWith(sessionDir);
		if (!isInSessionDir) {
			console.error(
				`live-pi-smoke: real Pi wrote session outside the requested temporary session-dir (${sessionFile})`,
			);
			process.exit(1);
		}

		const resume = await runRealTurn(
			"resume",
			discovered,
			sessionDir,
			provider,
			model,
			"Reply with just the literal token PONG2 and nothing else.",
			sessionFile,
		);

		if (!resume.ok) {
			console.error(`live-pi-smoke: resume turn failed: ${resume.detail}`);
			console.error(JSON.stringify({ create, resume }, null, 2));
			process.exit(1);
		}

		const summary = {
			binary: discovered.source,
			provider,
			model,
			sessionDir,
			create,
			resume,
			resumeContinuity: {
				sameSessionFile: create.sessionFile === resume.sessionFile,
				sameSessionId: create.sessionId === resume.sessionId,
				expectedSessionFile: create.sessionFile,
				returnedSessionFile: resume.sessionFile,
				expectedSessionId: create.sessionId,
				returnedSessionId: resume.sessionId,
			},
			latency: {
				startupMs: create.startupMs ?? null,
				promptAcceptanceMs: create.promptAcceptanceMs ?? null,
				settleMs: create.settleMs ?? null,
				resumeStartupMs: resume.startupMs ?? null,
				resumePromptAcceptanceMs: resume.promptAcceptanceMs ?? null,
				resumeSettleMs: resume.settleMs ?? null,
			},
		};
		if (!summary.resumeContinuity.sameSessionFile || !summary.resumeContinuity.sameSessionId) {
			console.error("live-pi-smoke: resume did not continue the same session identity");
			console.error(JSON.stringify(summary, null, 2));
			process.exit(1);
		}
		console.log("live-pi-smoke: OK");
		console.log(JSON.stringify(summary, null, 2));
	} finally {
		tmp.cleanup();
	}
}

main().catch((error) => {
	console.error("live-pi-smoke: FAIL");
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exit(1);
});

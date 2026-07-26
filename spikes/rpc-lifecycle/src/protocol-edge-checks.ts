import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient, type RpcEvent } from "./rpc-client.ts";

const sourceDir = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
	const tempDir = mkdtempSync(join(tmpdir(), "slam-protocol-"));
	try {
		await checkInterleavingAndStderr(tempDir);
		await checkEarlyExit(tempDir);
		console.log("protocol-edge-checks: OK");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

async function checkInterleavingAndStderr(tempDir: string): Promise<void> {
	const scenario = [
		{ kind: "wait-for-stdin", match: { type: "prompt" } },
		{ kind: "write-stderr", text: "diagnostic from fake pi\n" },
		{ kind: "write", record: { type: "agent_start" } },
		{ kind: "write", record: { type: "response", id: "req-1", command: "prompt", success: true } },
		{ kind: "wait-for-stdin", match: { type: "get_state" } },
		{
			kind: "write-fragmented",
			record: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "split ✨\u2028still one record" } },
			sizes: [1, 2, 3, 5, 8, 13],
		},
		{ kind: "write", record: { type: "response", id: "req-2", command: "get_state", success: true, data: { sessionId: "edge" } } },
		{ kind: "write", record: { type: "agent_settled" } },
	];
	const path = writeScenario(tempDir, "interleaving", scenario);
	const events: RpcEvent[] = [];
	const parseErrors: Error[] = [];
	const client = fakeClient(path, events, parseErrors);
	await client.start();
	const settled = client.untilEvent("agent_settled");
	const prompt = client.send({ type: "prompt", message: "hello" });
	const state = client.send({ type: "get_state" });
	const [promptResponse, stateResponse] = await Promise.all([prompt, state]);
	await settled;
	const exit = await client.stop();

	assert(promptResponse.command === "prompt", "prompt response was not correlated");
	assert(stateResponse.command === "get_state", "state response was not correlated");
	assert(events.some((event) => event.type === "message_update"), "fragmented event was not decoded");
	assert(parseErrors.length === 0, `unexpected parse errors: ${parseErrors.map((error) => error.message).join(", ")}`);
	assert(exit.stderr.includes("diagnostic from fake pi"), "stderr was not captured separately");
}

async function checkEarlyExit(tempDir: string): Promise<void> {
	const path = writeScenario(tempDir, "early-exit", [
		{ kind: "wait-for-stdin", match: { type: "prompt" }, respond: { type: "response", command: "prompt", success: true } },
		{ kind: "write-stderr", text: "provider disappeared\n" },
		{ kind: "exit", code: 17 },
	]);
	const client = fakeClient(path, [], []);
	await client.start();
	const settled = client.untilEvent("agent_settled", { timeoutMs: 5_000 });
	await client.send({ type: "prompt", message: "hello" });
	let failure = "";
	try {
		await settled;
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
	}
	const exit = await client.stop();
	assert(failure.includes("code=17"), `early exit did not reject event waiter promptly: ${failure}`);
	assert(exit.exitCode === 17, `expected exit code 17, got ${exit.exitCode}`);
	assert(exit.stderr.includes("provider disappeared"), "early-exit stderr was lost");
}

function fakeClient(scenarioPath: string, events: RpcEvent[], parseErrors: Error[]): RpcClient {
	return new RpcClient({
		spawn: {
			command: process.execPath,
			args: ["--experimental-strip-types", "--no-warnings", join(sourceDir, "fake-pi-server.ts"), scenarioPath],
		},
		onEvent: (event) => events.push(event),
		onParseError: (_line, error) => parseErrors.push(error),
	});
}

function writeScenario(tempDir: string, name: string, scenario: unknown): string {
	const path = join(tempDir, `${name}.json`);
	writeFileSync(path, JSON.stringify(scenario));
	return path;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

main().catch((error) => {
	console.error("protocol-edge-checks: FAIL");
	console.error(error instanceof Error ? error.stack : String(error));
	process.exitCode = 1;
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiProcess } from "../../src/pi/process.ts";
import { runTurn } from "../../src/pi/turn.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fakeProcess(steps: unknown[]): PiProcess {
	const directory = mkdtempSync(join(tmpdir(), "slam-turn-test-"));
	temporaryDirectories.push(directory);
	const scenario = join(directory, "scenario.json");
	writeFileSync(scenario, JSON.stringify(steps));
	return new PiProcess({
		executable: process.execPath,
		executableArgs: ["--experimental-strip-types", resolve("tests/fixtures/fake-pi-rpc.ts")],
		cwd: process.cwd(),
		args: [scenario],
	});
}

describe("turn coordinator", () => {
	it("waits for settlement after prompt acceptance and captures final state", async () => {
		const result = await runTurn(
			fakeProcess([
				{ type: "await", command: "prompt", response: { type: "response", command: "prompt", success: true } },
				{ type: "event", value: { type: "agent_end", willRetry: false } },
				{ type: "event", value: { type: "agent_settled" } },
				{
					type: "await",
					command: "get_state",
					response: { type: "response", command: "get_state", success: true, data: { sessionId: "one" } },
				},
			]),
			"hello",
		);
		expect(result.promptResponse.success).toBe(true);
		expect(result.events.map((event) => event.type)).toEqual(["agent_end", "agent_settled"]);
		expect(result.state).toEqual({ sessionId: "one" });
		expect(result.exit.code).toBe(0);
	});

	it("sends abort on interruption and preserves final state", async () => {
		const controller = new AbortController();
		const result = runTurn(
			fakeProcess([
				{ type: "await", command: "prompt", response: { type: "response", command: "prompt", success: true } },
				{ type: "await", command: "abort", response: { type: "response", command: "abort", success: true } },
				{ type: "event", value: { type: "agent_settled" } },
				{
					type: "await",
					command: "get_state",
					response: { type: "response", command: "get_state", success: true, data: { sessionId: "still-attached" } },
				},
			]),
			"wait",
			{ signal: controller.signal },
		);
		setTimeout(() => controller.abort(), 20);
		await expect(result).resolves.toMatchObject({ interrupted: true, state: { sessionId: "still-attached" } });
	});

	it("cleans up after prompt rejection", async () => {
		const process = fakeProcess([
			{
				type: "await",
				command: "prompt",
				response: { type: "response", command: "prompt", success: false, error: "no" },
			},
		]);
		await expect(runTurn(process, "hello")).rejects.toThrow("Pi rejected prompt: no");
		expect(() => globalThis.process.kill(process.pid ?? -1, 0)).toThrow();
	});

	it("does not treat retry or compaction boundaries as settlement", async () => {
		const result = await runTurn(
			fakeProcess([
				{ type: "await", command: "prompt", response: { type: "response", command: "prompt", success: true } },
				{ type: "event", value: { type: "agent_end", willRetry: true } },
				{ type: "event", value: { type: "auto_retry_start", attempt: 1 } },
				{ type: "event", value: { type: "compaction_start", reason: "overflow" } },
				{ type: "event", value: { type: "compaction_end", reason: "overflow", willRetry: true } },
				{ type: "event", value: { type: "agent_settled" } },
				{
					type: "await",
					command: "get_state",
					response: { type: "response", command: "get_state", success: true, data: {} },
				},
			]),
			"retry",
		);
		expect(result.events.at(-1)?.type).toBe("agent_settled");
		expect(result.events.map((event) => event.type)).toContain("compaction_end");
	});

	it("times out and reaps a turn that never settles", async () => {
		const process = fakeProcess([
			{ type: "await", command: "prompt", response: { type: "response", command: "prompt", success: true } },
			{ type: "delay", milliseconds: 5_000 },
		]);
		await expect(runTurn(process, "hang", { settleTimeoutMs: 20 })).rejects.toThrow(
			"Timed out waiting for agent_settled",
		);
		expect(() => globalThis.process.kill(process.pid ?? -1, 0)).toThrow();
	});
});

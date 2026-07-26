import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiProcess } from "../../src/pi/process.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function scenario(value: unknown): string {
	const directory = mkdtempSync(join(tmpdir(), "slam-process-test-"));
	temporaryDirectories.push(directory);
	const path = join(directory, "scenario.json");
	writeFileSync(path, JSON.stringify(value));
	return path;
}

function processFor(path: string, overrides: Partial<ConstructorParameters<typeof PiProcess>[0]> = {}): PiProcess {
	return new PiProcess({
		executable: process.execPath,
		executableArgs: ["--experimental-strip-types", resolve("tests/fixtures/fake-pi-rpc.ts")],
		cwd: process.cwd(),
		args: [path],
		...overrides,
	});
}

describe("Pi process lifecycle", () => {
	it("separates stderr and reaps the child", async () => {
		let stderr = "";
		const child = processFor(
			scenario([
				{ type: "stderr", value: "diagnostic\n" },
				{ type: "await", command: "get_state", response: { type: "response", command: "get_state", success: true } },
			]),
			{ onStderr: (text) => (stderr += text) },
		);
		await child.start();
		expect((await child.dispatcher.send({ type: "get_state" })).success).toBe(true);
		const pid = child.pid;
		const exit = await child.stop();
		expect(exit.code).toBe(0);
		expect(stderr).toBe("diagnostic\n");
		expect(() => process.kill(pid ?? -1, 0)).toThrow();
	});

	it("rejects outstanding requests when the child exits", async () => {
		const child = processFor(
			scenario([
				{ type: "await", command: "get_state" },
				{ type: "exit", code: 17 },
			]),
		);
		await child.start();
		await expect(child.dispatcher.send({ type: "get_state" })).rejects.toThrow("Pi process exited (code=17");
	});

	it("reports spawn failures", async () => {
		const child = new PiProcess({ executable: "/missing/pi", cwd: process.cwd() });
		await expect(child.start()).rejects.toThrow("ENOENT");
	});

	it("rejects pending work on malformed protocol output", async () => {
		const directory = mkdtempSync(join(tmpdir(), "slam-malformed-test-"));
		temporaryDirectories.push(directory);
		const script = join(directory, "malformed.mjs");
		writeFileSync(
			script,
			'process.stdin.once("data", () => process.stdout.write("not-json\\n")); setTimeout(() => {}, 5000);',
		);
		const child = new PiProcess({ executable: process.execPath, executableArgs: [script], cwd: process.cwd() });
		await child.start();
		await expect(child.dispatcher.send({ type: "get_state" })).rejects.toThrow("Invalid Pi RPC JSON record");
		await child.stop();
	});
});

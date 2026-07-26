import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
	const tempDir = mkdtempSync(join(tmpdir(), "slam-abort-"));
	try {
		const scenarioPath = join(tempDir, "scenario.json");
		writeFileSync(
			scenarioPath,
			JSON.stringify([
				{ kind: "wait-for-stdin", match: { type: "prompt" }, respond: { type: "response", command: "prompt", success: true } },
				{ kind: "write", record: { type: "agent_start" } },
				{ kind: "wait-for-stdin", match: { type: "abort" }, respond: { type: "response", command: "abort", success: true } },
				{ kind: "write", record: { type: "agent_end", messages: [], willRetry: false } },
				{ kind: "write", record: { type: "agent_settled" } },
				{ kind: "exit", code: 0 },
			]),
		);

		const child = spawn(
			process.execPath,
			["--experimental-strip-types", "--no-warnings", join(sourceDir, "abort-signal-inner.ts"), scenarioPath],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

		await waitUntil(() => stdout.includes("READY\n"), 5_000, `inner process did not become ready: ${stderr}`);
		child.kill("SIGINT");
		const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
		if (exitCode !== 0) throw new Error(`signal harness exited ${exitCode}: ${stderr}`);

		const summaryLine = stdout.trim().split("\n").at(-1);
		if (!summaryLine) throw new Error("signal harness emitted no summary");
		const summary = JSON.parse(summaryLine) as { ok?: boolean; events?: string[]; exit?: { exitCode?: number | null } };
		if (!summary.ok || !summary.events?.includes("agent_settled") || summary.exit?.exitCode !== 0) {
			throw new Error(`unexpected abort summary: ${summaryLine}`);
		}
		console.log("abort-check: OK");
		console.log(summaryLine);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, message: string): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

main().catch((error) => {
	console.error("abort-check: FAIL");
	console.error(error instanceof Error ? error.stack : String(error));
	process.exitCode = 1;
});

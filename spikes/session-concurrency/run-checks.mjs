import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const spikeDir = dirname(fileURLToPath(import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), "slam-concurrency-"));

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	try {
		const sessionFile = join(tempDir, "session.jsonl");
		const readyFile = join(tempDir, "ready");
		const releaseFile = join(tempDir, "release");
		const rootId = "root-entry";
		writeFileSync(sessionFile, [
			JSON.stringify({ type: "session", version: 3, id: "session-id", timestamp: new Date().toISOString(), cwd: tempDir }),
			JSON.stringify({ type: "message", id: rootId, parentId: null, timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "root" }], timestamp: Date.now(), provider: "fake", model: "fake" } }),
		].join("\n") + "\n");

		const first = startWriter(sessionFile, "first", readyFile, releaseFile);
		const second = startWriter(sessionFile, "second", readyFile, releaseFile);
		await waitUntil(() => readLines(readyFile).length === 2, 5_000, "writers did not both load the initial leaf");
		const loaded = readLines(readyFile);
		assert(loaded.every((line) => line.endsWith(`:${rootId}`)), `writers loaded different leaves: ${loaded.join(", ")}`);
		writeFileSync(releaseFile, "go\n");

		const [firstResult, secondResult] = await Promise.all([first, second]);
		assert(firstResult.code === 0 && secondResult.code === 0, "a writer failed");
		const lines = readLines(sessionFile);
		assert(lines.length === 4, `expected header, root, and two writes; got ${lines.length}`);
		const parsed = lines.map((line) => JSON.parse(line));
		const appended = parsed.slice(2);
		assert(appended.every((entry) => entry.parentId === rootId), "concurrent writes were not sibling branches");
		assert(new Set(appended.map((entry) => entry.id)).size === 2, "concurrent entry IDs collided");
		assert(parsed.at(-1).id === appended.at(-1).id, "last append was not the leaf a fresh loader would select");

		console.log("session-concurrency: OK");
		console.log(JSON.stringify({ loaded, writerResults: [firstResult.summary, secondResult.summary], appendOrder: appended.map((entry) => ({ id: entry.id, parentId: entry.parentId, content: entry.message.content })), reopenedLeaf: parsed.at(-1).id }, null, 2));
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function startWriter(sessionFile, label, readyFile, releaseFile) {
	const child = spawn(process.execPath, [join(spikeDir, "writer.mjs"), sessionFile, label, readyFile, releaseFile], { stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => (stdout += chunk));
	child.stderr.on("data", (chunk) => (stderr += chunk));
	return new Promise((resolve) => child.once("exit", (code, signal) => {
		if (stderr) process.stderr.write(stderr);
		resolve({ code, signal, summary: stdout.trim() ? JSON.parse(stdout.trim()) : null });
	}));
}

function readLines(path) {
	try {
		return readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

async function waitUntil(predicate, timeoutMs, message) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

main().catch((error) => {
	console.error("session-concurrency: FAIL");
	console.error(error instanceof Error ? error.stack : String(error));
	process.exitCode = 1;
});

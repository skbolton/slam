import { appendFileSync, readFileSync } from "node:fs";

const [sessionFile, label, readyFile, releaseFile] = process.argv.slice(2);
if (!sessionFile || !label || !readyFile || !releaseFile) throw new Error("missing writer arguments");

const entries = readFileSync(sessionFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const prior = entries.filter((entry) => entry.type !== "session").at(-1);
const parentId = prior?.id ?? null;

appendFileSync(readyFile, `${label}:${parentId}\n`);
while (true) {
	try {
		readFileSync(releaseFile);
		break;
	} catch {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

const id = `${label}-${process.pid}`;
appendFileSync(
	sessionFile,
	`${JSON.stringify({
		type: "message",
		id,
		parentId,
		timestamp: new Date().toISOString(),
		message: { role: "user", content: label, timestamp: Date.now() },
	})}\n`,
);
process.stdout.write(`${JSON.stringify({ label, id, parentId })}\n`);

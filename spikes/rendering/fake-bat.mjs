import { appendFileSync } from "node:fs";

const mode = process.env.FAKE_BAT_MODE ?? "capture";
const log = process.env.FAKE_BAT_LOG;
if (!log) throw new Error("FAKE_BAT_LOG is required");

appendFileSync(log, `${JSON.stringify({ kind: "start", argv: process.argv.slice(2), theme: process.env.BAT_THEME ?? null })}\n`);

if (mode === "exit") process.exit(19);

process.stdin.on("data", (chunk) => {
	appendFileSync(log, `${JSON.stringify({ kind: "chunk", text: chunk.toString("utf8") })}\n`);
	if (mode === "broken-pipe") process.exit(7);
	process.stdout.write(chunk);
});
process.stdin.on("end", () => process.exit(0));

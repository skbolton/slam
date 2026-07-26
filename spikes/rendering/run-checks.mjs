import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { renderFragments } from "./render-spike.mjs";

const spikeDir = dirname(fileURLToPath(import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), "slam-render-"));
let assertions = 0;

function assert(condition, message) {
	assertions++;
	if (!condition) throw new Error(message);
}

function sink() {
	let value = "";
	return {
		stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }),
		value: () => value,
	};
}

function records(path) {
	return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function main() {
	try {
		const log = join(tempDir, "capture.log");
		const out = sink();
		const err = sink();
		const fragments = ["# Heading\n\n", "partial ", "line\n\n```js\n", "const x = 1;\n", "```\n✨\n"];
		await renderFragments({
			bat: process.execPath,
			batArgsPrefix: [join(spikeDir, "fake-bat.mjs")],
			fragments,
			delayMs: 10,
			stdout: out.stream,
			stderr: err.stream,
			env: {
				...process.env,
				NODE_OPTIONS: "",
				FAKE_BAT_LOG: log,
				BAT_THEME: "user-selected-theme",
			},
		});
		const captured = records(log);
		const start = captured.find((record) => record.kind === "start");
		assert(start, "fake Bat was not started");
		assert(start.argv.includes("--language=markdown"), "Markdown language was not forced");
		assert(start.argv.includes("--paging=never"), "paging was not disabled");
		assert(start.argv.includes("--color=always"), "color was not preserved across the renderer pipe");
		assert(start.argv.includes("--style=plain"), "decorative file chrome was not disabled");
		assert(!start.argv.some((arg) => arg === "--theme" || arg.startsWith("--theme=")), "theme was overridden");
		assert(start.theme === "user-selected-theme", "user Bat theme environment was not preserved");
		assert(captured.filter((record) => record.kind === "start").length === 1, "more than one Bat process was used");
		const chunks = captured.filter((record) => record.kind === "chunk").map((record) => record.text);
		assert(chunks.length > 1, "input was buffered into a single complete document");
		assert(chunks.join("") === fragments.join(""), "fragmented Markdown changed in transit");
		assert(out.value() === fragments.join(""), "renderer stdout was not forwarded");
		assert(err.value() === "", "unexpected renderer diagnostic");

		let startupFailure = "";
		try {
			await renderFragments({ bat: join(tempDir, "missing-bat"), fragments: ["x"] });
		} catch (error) {
			startupFailure = error instanceof Error ? error.message : String(error);
		}
		assert(startupFailure.length > 0, "missing Bat executable did not fail visibly");

		const exitLog = join(tempDir, "exit.log");
		writeFileSync(exitLog, "");
		let exitFailure = "";
		try {
			await renderFragments({
				bat: process.execPath,
				batArgsPrefix: [join(spikeDir, "fake-bat.mjs")],
				fragments: ["x"],
				env: { ...process.env, NODE_OPTIONS: "", FAKE_BAT_LOG: exitLog, FAKE_BAT_MODE: "exit" },
			});
		} catch (error) {
			exitFailure = error instanceof Error ? error.message : String(error);
		}
		assert(exitFailure.includes("code=19"), "nonzero Bat exit was not reported");

		const brokenLog = join(tempDir, "broken.log");
		writeFileSync(brokenLog, "");
		let brokenFailure = "";
		try {
			await renderFragments({
				bat: process.execPath,
				batArgsPrefix: [join(spikeDir, "fake-bat.mjs")],
				fragments: ["first", "second"],
				delayMs: 20,
				env: { ...process.env, NODE_OPTIONS: "", FAKE_BAT_LOG: brokenLog, FAKE_BAT_MODE: "broken-pipe" },
			});
		} catch (error) {
			brokenFailure = error instanceof Error ? error.message : String(error);
		}
		assert(brokenFailure.length > 0, "broken renderer pipe was not reported");

		console.log(`rendering-checks: ${assertions} assertions OK`);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error("rendering-checks: FAIL");
	console.error(error instanceof Error ? error.stack : String(error));
	process.exitCode = 1;
});

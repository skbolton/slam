import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeShellState } from "../../src/shell/state-record.ts";

const plugin = resolve("slam.plugin.zsh");

function invoke(expression: string): { status: number; message: string } {
	const directory = mkdtempSync(join(tmpdir(), "slam-colon-test-"));
	try {
		const companion = join(directory, "slam");
		const captured = join(directory, "message");
		writeFileSync(companion, `#!/bin/sh\nprintf '%s' "$3" > ${JSON.stringify(captured)}\nexit 37\n`, { mode: 0o700 });
		const output = execFileSync(
			"zsh",
			[
				"-f",
				"-c",
				`SLAM_BIN_OVERRIDE="$2"; source "$1"; set +e; _slam_send_message ${expression}; print -r -- $?`,
				"_",
				plugin,
				companion,
			],
			{ encoding: "utf8" },
		);
		return { status: Number(output.trim()), message: readFileSync(captured, "utf8") };
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

describe("colon message contract", () => {
	it("joins multiple arguments and propagates status", () => {
		expect(invoke("explain this")).toEqual({ status: 37, message: "explain this" });
	});

	it("preserves a single multiline argument and leading dashes", () => {
		expect(invoke("$'--first\\nsecond'")).toEqual({ status: 37, message: "--first\nsecond" });
	});

	it("rejects explicit empty input before invoking the companion", () => {
		const output = execFileSync(
			"zsh",
			["-f", "-c", 'source "$1"; set +e; _slam_send_message "" 2>/dev/null; print -r -- $?', "_", plugin],
			{
				encoding: "utf8",
			},
		);
		expect(output).toBe("2\n");
	});

	it("preserves glob characters as message content", () => {
		expect(invoke("'review *.ts [carefully]' ")).toEqual({ status: 37, message: "review *.ts [carefully]" });
	});

	it("connects the backend to the controlling terminal", () => {
		const source = execFileSync("zsh", ["-f", "-c", 'source "$1"; functions _slam_send_message', "_", plugin], {
			encoding: "utf8",
		});
		expect(source).toContain("< /dev/tty > /dev/tty");
	});

	it("passes the session created by one message to the next", () => {
		const directory = mkdtempSync(join(tmpdir(), "slam-colon-session-test-"));
		try {
			const companion = join(directory, "slam");
			const captured = join(directory, "sessions");
			const record = join(directory, "state-record");
			const sessionFile = join(directory, "session.jsonl");
			writeFileSync(
				record,
				encodeShellState({
					SLAM_ACTIVE: "1",
					SLAM_SESSION_ID: "session-one",
					SLAM_SESSION_NAME: "",
					SLAM_SESSION_FILE: sessionFile,
					SLAM_SESSION_CWD: directory,
					SLAM_PROVIDER: "provider",
					SLAM_MODEL: "model",
					SLAM_THINKING_LEVEL: "off",
					SLAM_MODEL_PENDING: "0",
				}),
				{ mode: 0o600 },
			);
			writeFileSync(
				companion,
				`#!/bin/sh\nprintf '%s\\t%s\\n' "$SLAM_SESSION_ID" "$SLAM_SESSION_FILE" >> ${JSON.stringify(captured)}\ncp ${JSON.stringify(record)} "$SLAM_STATE_FILE"\n`,
				{ mode: 0o700 },
			);

			const output = execFileSync(
				"zsh",
				[
					"-f",
					"-c",
					'source "$1"; _slam_send_message first; _slam_send_message second; print -r -- "$SLAM_SESSION_ID:$SLAM_SESSION_FILE"',
					"_",
					plugin,
				],
				{ encoding: "utf8", env: { ...process.env, SLAM_BIN_OVERRIDE: companion } },
			);

			expect(readFileSync(captured, "utf8")).toBe(`\t\nsession-one\t${sessionFile}\n`);
			expect(output).toBe(`session-one:${sessionFile}\n`);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("passes thinking visibility to the companion", () => {
		const directory = mkdtempSync(join(tmpdir(), "slam-colon-thinking-test-"));
		try {
			const companion = join(directory, "slam");
			const captured = join(directory, "thinking");
			writeFileSync(
				companion,
				`#!/bin/sh\nprintf '%s' "$SLAM_THINKING_VISIBLE" > ${JSON.stringify(captured)}\nexit 37\n`,
				{
					mode: 0o700,
				},
			);
			execFileSync(
				"zsh",
				["-f", "-c", 'source "$1"; :thinking on >/dev/null; _slam_send_message test || true', "_", plugin],
				{ env: { ...process.env, SLAM_BIN_OVERRIDE: companion } },
			);
			expect(readFileSync(captured, "utf8")).toBe("1");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

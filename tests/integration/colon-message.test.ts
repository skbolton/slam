import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
});

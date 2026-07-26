import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeShellState, type ShellState } from "../../src/shell/state-record.ts";

const plugin = resolve("slam.plugin.zsh");

function apply(record: string): string {
	const directory = mkdtempSync(join(tmpdir(), "slam-state-test-"));
	try {
		const path = join(directory, "state");
		writeFileSync(path, record, { mode: 0o600 });
		return execFileSync(
			"zsh",
			[
				"-f",
				"-c",
				'source "$1"; SLAM_SESSION_ID=old; _slam_apply_state_file "$2" || true; print -r -- "$SLAM_SESSION_ID:$SLAM_MODEL"',
				"_",
				plugin,
				path,
			],
			{ encoding: "utf8" },
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

const valid: ShellState = {
	SLAM_ACTIVE: "1",
	SLAM_SESSION_ID: "new",
	SLAM_SESSION_NAME: "name",
	SLAM_SESSION_FILE: "/tmp/session",
	SLAM_SESSION_CWD: "/tmp/project",
	SLAM_PROVIDER: "zionlab",
	SLAM_MODEL: "Delta",
	SLAM_THINKING_LEVEL: "off",
	SLAM_MODEL_PENDING: "0",
};

describe("parent shell state application", () => {
	it("applies a complete validated record", () => {
		expect(apply(encodeShellState(valid))).toBe("new:Delta\n");
	});

	it("preserves prior state for unknown, malformed, or incomplete records", () => {
		expect(apply(`${encodeShellState(valid)}UNKNOWN=MQ==\n`)).toBe("old:\n");
		expect(apply("SLAM_STATE_V1\nSLAM_ACTIVE=bad!\n")).toBe("old:\n");
		expect(apply("SLAM_STATE_V1\nSLAM_ACTIVE=MQ==\n")).toBe("old:\n");
	});
});

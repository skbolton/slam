import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const plugin = resolve("slam.plugin.zsh");

function run(script: string): string {
	return execFileSync("zsh", ["-f", "-c", script, "_", plugin], { encoding: "utf8" });
}

describe("plugin initialization", () => {
	it("is silent and idempotent", () => {
		expect(run('source "$1"; source "$1"')).toBe("");
	});

	it("removes the legacy colon function when upgrading in place", () => {
		const output = run(`
      function : { local SLAM_STATE_FILE=legacy; }
      source "$1"
      whence -w :
    `);
		expect(output).toBe(":: builtin\n");
	});

	it("initializes public state without exporting it", () => {
		const output = run(`
      source "$1"
      print -r -- "$SLAM_ACTIVE:$SLAM_MODEL_PENDING"
      print -r -- "\${SLAM_SESSION_ID-unset}:\${SLAM_MODEL-unset}"
      [[ \${(t)SLAM_ACTIVE} == *export* ]] && print exported || print local
    `);
		expect(output).toBe("0:0\n:\nlocal\n");
	});

	it("does not leak state into a child shell", () => {
		const output = run(`
      source "$1"
      SLAM_ACTIVE=1
			SLAM_THINKING_VISIBLE=1
			zsh -f -c 'print -r -- "\${SLAM_ACTIVE-unset}:\${SLAM_THINKING_VISIBLE-unset}"'
    `);
		expect(output).toBe("unset:unset\n");
	});

	it("preserves builtin colon behavior", () => {
		const output = run(`
      source "$1"
      :
      builtin : ignored
      print -r -- ok
    `);
		expect(output).toBe("ok\n");
	});

	it("keeps public prompt state available under nounset", () => {
		const output = run(`
      setopt nounset
      source "$1"
			print -r -- "$SLAM_ACTIVE:$SLAM_SESSION_ID:$SLAM_SESSION_NAME:$SLAM_SESSION_FILE:$SLAM_SESSION_CWD:$SLAM_PROVIDER:$SLAM_MODEL:$SLAM_THINKING_LEVEL:$SLAM_MODEL_PENDING:$SLAM_THINKING_VISIBLE"
		`);
		expect(output).toBe("0::::::::0:1\n");
	});
});

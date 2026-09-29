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

	it("exports model metadata but keeps session state shell-local", () => {
		const output = run(`
      source "$1"
      print -r -- "$SLAM_ACTIVE:$SLAM_MODEL_PENDING"
      print -r -- "\${SLAM_SESSION_ID-unset}:\${SLAM_MODEL-unset}"
      [[ \${(t)SLAM_ACTIVE} == *export* ]] && print exported || print local
			[[ \${(t)SLAM_SESSION_FILE} == *export* ]] && print exported || print local
			[[ \${(t)SLAM_PROVIDER} == *export* ]] && print exported || print local
			[[ \${(t)SLAM_MODEL} == *export* ]] && print exported || print local
    `);
		expect(output).toBe("0:0\n:\nlocal\nlocal\nexported\nexported\n");
	});

	it("exposes model metadata to child processes without leaking session identity", () => {
		const output = run(`
      source "$1"
      SLAM_ACTIVE=1
			SLAM_SESSION_ID=one
			SLAM_SESSION_FILE=/tmp/one
			SLAM_PROVIDER=provider
			SLAM_MODEL=model
			SLAM_THINKING_VISIBLE=1
			zsh -f -c 'print -r -- "\${SLAM_PROVIDER-unset}:\${SLAM_MODEL-unset}:\${SLAM_ACTIVE-unset}:\${SLAM_SESSION_ID-unset}:\${SLAM_SESSION_FILE-unset}:\${SLAM_THINKING_VISIBLE-unset}"'
    `);
		expect(output).toBe("provider:model:unset:unset:unset:unset\n");
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

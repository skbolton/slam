import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const plugin = resolve("slam.plugin.zsh");

describe("session shell commands", () => {
	it(":new clears attachment while preserving model and display preferences", () => {
		const output = execFileSync(
			"zsh",
			[
				"-f",
				"-c",
				'source "$1"; SLAM_ACTIVE=1; SLAM_SESSION_ID=one; SLAM_SESSION_FILE=/tmp/one; SLAM_PROVIDER=p; SLAM_MODEL=m; SLAM_MODEL_PENDING=1; SLAM_THINKING_VISIBLE=1; :new; print -r -- "$SLAM_ACTIVE:$SLAM_SESSION_ID:$SLAM_PROVIDER:$SLAM_MODEL:$SLAM_MODEL_PENDING:$SLAM_THINKING_VISIBLE"',
				"_",
				plugin,
			],
			{ encoding: "utf8" },
		);
		expect(output).toBe("0::p:m:1:1\n");
	});

	it(":name rejects an unattached shell", () => {
		const output = execFileSync(
			"zsh",
			["-f", "-c", 'source "$1"; set +e; :name demo 2>/dev/null; print -r -- $?', "_", plugin],
			{
				encoding: "utf8",
			},
		);
		expect(output).toBe("1\n");
	});

	it("defines every adjacent control command", () => {
		const output = execFileSync(
			"zsh",
			[
				"-f",
				"-c",
				'source "$1"; for fn in :info :sessions :attach :new :name :models :thinking; do (( $+functions[$fn] )) || exit 1; done; print ok',
				"_",
				plugin,
			],
			{ encoding: "utf8" },
		);
		expect(output).toBe("ok\n");
	});

	it(":thinking toggles visibility and accepts explicit states", () => {
		const output = execFileSync(
			"zsh",
			[
				"-f",
				"-c",
				'source "$1"; :thinking; :thinking off; :thinking on; print -r -- "$SLAM_THINKING_VISIBLE"',
				"_",
				plugin,
			],
			{ encoding: "utf8" },
		);
		expect(output).toBe("Thinking display: off\nThinking display: off\nThinking display: on\n1\n");
	});

	it(":thinking rejects invalid input without changing visibility", () => {
		const output = execFileSync(
			"zsh",
			[
				"-f",
				"-c",
				'source "$1"; SLAM_THINKING_VISIBLE=1; set +e; :thinking maybe 2>/dev/null; print -r -- "$?:$SLAM_THINKING_VISIBLE"',
				"_",
				plugin,
			],
			{ encoding: "utf8" },
		);
		expect(output).toBe("2:1\n");
	});
});

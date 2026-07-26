import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const plugin = resolve("slam.plugin.zsh");

describe("interactive colon dispatch", () => {
	it("does not replace the colon builtin", () => {
		const output = execFileSync("zsh", ["-f", "-c", 'source "$1"; whence -w :', "_", plugin], { encoding: "utf8" });
		expect(output).toBe(":: builtin\n");
	});

	it("registers dispatch on Enter rather than the colon key", () => {
		const output = execFileSync(
			"zsh",
			[
				"-fic",
				`source "$1"
        zle -l -L _slam_accept_line
        bindkey '^M'
        bindkey ':'`,
				"_",
				plugin,
			],
			{ encoding: "utf8" },
		);
		expect(output).toContain("zle -N _slam_accept_line");
		expect(output).toContain('"^M" _slam_accept_line');
		expect(output).toContain('":" self-insert');
	});

	it("dispatches directly and protects output during prompt reset", () => {
		const source = execFileSync(
			"zsh",
			["-f", "-c", 'source "$1"; functions _slam_accept_line _slam_reset', "_", plugin],
			{
				encoding: "utf8",
			},
		);
		expect(source).toContain('print -s -- "$original_buffer"');
		expect(source).toContain("local display_lines");
		expect(source).toContain("_slam_osc133 B");
		expect(source).toContain("BUFFERLINES");
		expect(source).toContain("zle -I");
		expect(source).toContain("zle reset-prompt");
		expect(source).not.toContain("clear-screen");
	});

	it("reapplies bindings after zsh-vi-mode initialization", () => {
		const output = execFileSync("zsh", ["-fic", 'source "$1"; print -rl -- $zvm_after_init_commands', "_", plugin], {
			encoding: "utf8",
		});
		expect(output).toContain("_slam_apply_keybindings");
	});
});

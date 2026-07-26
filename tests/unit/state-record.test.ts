import { describe, expect, it } from "vitest";
import { encodeShellState, SHELL_STATE_KEYS, type ShellState } from "../../src/shell/state-record.ts";

describe("shell state record", () => {
	it("encodes every allowlisted field without exposing raw values", () => {
		const state = Object.fromEntries(
			SHELL_STATE_KEYS.map((key) => [key, key === "SLAM_ACTIVE" ? "1" : "secret value"]),
		) as ShellState;
		const encoded = encodeShellState(state);
		expect(encoded).toContain("SLAM_STATE_V1\n");
		expect(encoded).not.toContain("secret value");
		for (const key of SHELL_STATE_KEYS) expect(encoded).toContain(`${key}=`);
	});
});

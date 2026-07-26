import { describe, expect, it } from "vitest";
import type { FzfChoice } from "../../src/ui/fzf.ts";

describe("Fzf choice identity", () => {
	it("allows duplicate display labels to retain distinct stable values", () => {
		const choices: FzfChoice[] = [
			{ value: "0", label: "same" },
			{ value: "1", label: "same" },
		];
		expect(new Set(choices.map((choice) => choice.value)).size).toBe(2);
	});
});

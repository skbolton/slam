import { describe, expect, it } from "vitest";
import { presentEvent } from "../../src/rendering/events.ts";

function render(event: Record<string, unknown>): string {
	let output = "";
	presentEvent(event as { type: string }, (text) => (output += text));
	return output;
}

describe("event presentation", () => {
	it("shows concise tool lifecycle without accumulated updates", () => {
		expect(render({ type: "tool_execution_start", toolName: "bash", args: { command: "npm test" } })).toBe(
			"→ bash: npm test\n",
		);
		expect(render({ type: "tool_execution_update", partialResult: { content: [] } })).toBe("");
		expect(render({ type: "tool_execution_end", toolName: "bash", isError: false })).toBe("✓ bash\n");
	});

	it("shows bounded failed-tool details", () => {
		expect(
			render({
				type: "tool_execution_end",
				toolName: "edit",
				isError: true,
				result: { content: [{ type: "text", text: "denied\nsecret" }] },
			}),
		).toBe("✗ edit: denied secret\n");
	});

	it("hides thinking and reports retry and compaction", () => {
		expect(render({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hidden" } })).toBe(
			"",
		);
		expect(render({ type: "auto_retry_start", attempt: 2 })).toContain("attempt 2");
		expect(render({ type: "compaction_start" })).toBe("Compacting session context…\n");
	});

	it("presents useful fire-and-forget extension output", () => {
		expect(render({ type: "extension_ui_request", method: "notify", notifyType: "warning", message: "careful" })).toBe(
			"[warning] careful\n",
		);
		expect(render({ type: "extension_ui_request", method: "setStatus", statusText: "working" })).toBe("working\n");
		expect(render({ type: "extension_ui_request", method: "setTitle", title: "ignored" })).toBe("");
	});
});

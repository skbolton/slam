import { describe, expect, it } from "vitest";
import { presentEvent } from "../../src/rendering/events.ts";

function render(event: Record<string, unknown>): { output: string; source: ReturnType<typeof presentEvent> } {
	let output = "";
	const source = presentEvent(event as { type: string }, (text) => (output += text));
	return { output, source };
}

describe("event presentation", () => {
	it("shows concise tool lifecycle without accumulated updates", () => {
		expect(render({ type: "tool_execution_start", toolName: "bash", args: { command: "npm test" } })).toEqual({
			output: " bash\n",
			source: { language: "bash", text: "npm test" },
		});
		expect(render({ type: "tool_execution_update", partialResult: { content: [] } })).toEqual({
			output: "",
			source: undefined,
		});
		expect(render({ type: "tool_execution_end", toolName: "bash", isError: false })).toEqual({
			output: "✓ bash\n",
			source: undefined,
		});
	});

	it("extracts Python source and summarizes non-script tools", () => {
		expect(render({ type: "tool_execution_start", toolName: "python", args: { code: "print('hi')" } })).toEqual({
			output: " python\n",
			source: { language: "python", text: "print('hi')" },
		});
		expect(render({ type: "tool_execution_start", toolName: "read", args: { path: "src/index.ts" } })).toEqual({
			output: " read: src/index.ts\n",
			source: undefined,
		});
	});

	it("shows bounded failed-tool details", () => {
		expect(
			render({
				type: "tool_execution_end",
				toolName: "edit",
				isError: true,
				result: { content: [{ type: "text", text: "denied\nsecret" }] },
			}),
		).toEqual({ output: "✗ edit: denied secret\n", source: undefined });
	});

	it("hides thinking and reports retry and compaction", () => {
		expect(
			render({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hidden" } }),
		).toEqual({
			output: "",
			source: undefined,
		});
		expect(render({ type: "auto_retry_start", attempt: 2 }).output).toContain("attempt 2");
		expect(render({ type: "compaction_start" })).toEqual({
			output: "Compacting session context…\n",
			source: undefined,
		});
	});

	it("presents useful fire-and-forget extension output", () => {
		expect(
			render({ type: "extension_ui_request", method: "notify", notifyType: "warning", message: "careful" }),
		).toEqual({
			output: "[warning] careful\n",
			source: undefined,
		});
		expect(render({ type: "extension_ui_request", method: "setStatus", statusText: "working" })).toEqual({
			output: "working\n",
			source: undefined,
		});
		expect(render({ type: "extension_ui_request", method: "setTitle", title: "ignored" })).toEqual({
			output: "",
			source: undefined,
		});
	});
});

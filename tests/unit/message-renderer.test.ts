import { describe, expect, it } from "vitest";
import { AssistantMessageRenderer, type ContentLanguage, type ContentRenderer } from "../../src/rendering/message.ts";

interface RenderedSegment {
	readonly language: ContentLanguage;
	output: string;
	ended: boolean;
}

function recordingFactory(segments: RenderedSegment[]): (language: ContentLanguage) => ContentRenderer {
	return (language) => {
		const segment = { language, output: "", ended: false };
		segments.push(segment);
		return {
			async write(text: string): Promise<void> {
				segment.output += text;
			},
			async end(): Promise<void> {
				segment.ended = true;
			},
		};
	};
}

describe("assistant message renderer", () => {
	it("streams thinking inside a JavaScript multiline comment", async () => {
		const segments: RenderedSegment[] = [];
		const renderer = new AssistantMessageRenderer(recordingFactory(segments), true);
		await renderer.write({ type: "thinking_delta", delta: "first " });
		await renderer.write({ type: "thinking_delta", delta: "line\nsecond\n\nlast" });
		await renderer.end();

		expect(segments).toEqual([{ language: "js", output: "/* first line\nsecond\n\nlast */", ended: true }]);
	});

	it("uses separate JavaScript and Markdown renderers for content blocks", async () => {
		const segments: RenderedSegment[] = [];
		const renderer = new AssistantMessageRenderer(recordingFactory(segments), true);
		await renderer.write({ type: "text_delta", delta: "**Before**" });
		await renderer.write({ type: "thinking_delta", delta: "Reason\nMore" });
		await renderer.write({ type: "text_delta", delta: "# After" });
		await renderer.end();

		expect(segments).toEqual([
			{ language: "markdown", output: "**Before**\n\n", ended: true },
			{ language: "js", output: "/* Reason\nMore */\n\n", ended: true },
			{ language: "markdown", output: "# After", ended: true },
		]);
	});

	it("omits hidden thinking without splitting Markdown", async () => {
		const segments: RenderedSegment[] = [];
		const renderer = new AssistantMessageRenderer(recordingFactory(segments), false);
		await renderer.write({ type: "text_delta", delta: "Before " });
		await renderer.write({ type: "thinking_delta", delta: "secret\nreasoning" });
		await renderer.write({ type: "text_delta", delta: "after" });
		await renderer.end();

		expect(segments).toEqual([{ language: "markdown", output: "Before after", ended: true }]);
	});
});

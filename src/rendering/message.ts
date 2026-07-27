export interface ContentRenderer {
	write(text: string): Promise<void>;
	end(): Promise<void>;
}

export type ContentLanguage = "markdown" | "js";
export type ContentRendererFactory = (language: ContentLanguage) => ContentRenderer;

export interface AssistantContentEvent {
	readonly type?: string;
	readonly delta?: string;
}

type VisibleBlock = "text" | "thinking";

export class AssistantMessageRenderer {
	private readonly createRenderer: ContentRendererFactory;
	private readonly showThinking: boolean;
	private renderer: ContentRenderer | undefined;
	private activeBlock: VisibleBlock | undefined;
	private endsWithNewline = false;

	constructor(createRenderer: ContentRendererFactory, showThinking: boolean) {
		this.createRenderer = createRenderer;
		this.showThinking = showThinking;
	}

	async write(event: AssistantContentEvent): Promise<void> {
		if (typeof event.delta !== "string" || event.delta.length === 0) return;
		if (event.type === "text_delta") {
			await this.beginBlock("text");
			await this.writeContent(event.delta);
		} else if (event.type === "thinking_delta" && this.showThinking) {
			await this.beginBlock("thinking");
			await this.writeContent(event.delta);
		}
	}

	async end(): Promise<void> {
		await this.closeThinkingComment();
		await this.renderer?.end();
		this.renderer = undefined;
		this.activeBlock = undefined;
	}

	private async beginBlock(block: VisibleBlock): Promise<void> {
		if (this.activeBlock === block) return;
		if (this.renderer) {
			await this.closeThinkingComment();
			await this.writeContent(this.endsWithNewline ? "\n" : "\n\n");
			await this.renderer.end();
		}
		this.activeBlock = block;
		this.renderer = this.createRenderer(block === "thinking" ? "js" : "markdown");
		this.endsWithNewline = false;
		if (block === "thinking") await this.writeContent("/* ");
	}

	private async closeThinkingComment(): Promise<void> {
		if (this.activeBlock !== "thinking" || !this.renderer) return;
		await this.writeContent(" */");
		this.activeBlock = undefined;
	}

	private async writeContent(text: string): Promise<void> {
		if (!this.renderer) throw new Error("Assistant content renderer is unavailable");
		await this.renderer.write(text);
		this.endsWithNewline = text.endsWith("\n");
	}
}

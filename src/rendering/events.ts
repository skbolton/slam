import type { RpcEvent } from "../pi/protocol.ts";

export function presentEvent(event: RpcEvent, write: (text: string) => void): void {
	switch (event.type) {
		case "tool_execution_start":
			write(`→ ${string(event.toolName)}${argumentSummary(event.args)}\n`);
			break;
		case "tool_execution_end":
			write(
				`${event.isError === true ? "✗" : "✓"} ${string(event.toolName)}${event.isError === true ? errorSummary(event.result) : ""}\n`,
			);
			break;
		case "auto_retry_start":
			write(`Retrying after provider error (attempt ${string(event.attempt)})…\n`);
			break;
		case "compaction_start":
			write("Compacting session context…\n");
			break;
		case "extension_ui_request":
			if (event.method === "notify") write(`[${string(event.notifyType || "info")}] ${string(event.message)}\n`);
			else if (event.method === "setStatus" && event.statusText) write(`${string(event.statusText)}\n`);
			else if (event.method === "setWidget" && Array.isArray(event.widgetLines)) {
				for (const line of event.widgetLines) write(`${string(line)}\n`);
			}
			break;
	}
}

function argumentSummary(value: unknown): string {
	if (!value || typeof value !== "object") return "";
	const args = value as Record<string, unknown>;
	const candidate = args.command ?? args.path ?? args.file_path ?? args.filePath;
	if (typeof candidate !== "string") return "";
	const sanitized = candidate.replace(/[\r\n\t]+/g, " ");
	return `: ${sanitized.length > 160 ? `${sanitized.slice(0, 157)}…` : sanitized}`;
}

function errorSummary(value: unknown): string {
	if (!value || typeof value !== "object") return "";
	const content = (value as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	const text = content.find(
		(item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text",
	) as { text?: unknown } | undefined;
	if (typeof text?.text !== "string") return "";
	return `: ${text.text.replace(/[\r\n\t]+/g, " ").slice(0, 200)}`;
}

function string(value: unknown): string {
	return value === undefined ? "unknown" : String(value);
}

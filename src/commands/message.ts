import { writeFileSync } from "node:fs";
import { PiProcess } from "../pi/process.ts";
import { runTurn } from "../pi/turn.ts";
import { sessionProcessOptions, verifiedAttachment, type ShellAttachment } from "../session/coordinator.ts";
import { encodeShellState, type ShellState } from "../shell/state-record.ts";
import { BatRenderer } from "../rendering/bat.ts";
import { presentEvent } from "../rendering/events.ts";
import { AssistantMessageRenderer } from "../rendering/message.ts";
import { handleExtensionDialog } from "../ui/extensions.ts";

export interface MessageCommandOptions {
	readonly message: string;
	readonly stateFile?: string;
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
}

export async function messageCommand(options: MessageCommandOptions): Promise<number> {
	const attachment = attachmentFromEnvironment(options.env);
	const process = new PiProcess(
		sessionProcessOptions({
			executable: required(options.env.SLAM_PI, "SLAM_PI"),
			shellCwd: options.cwd,
			attachment,
			env: options.env,
		}),
	);
	const controller = new AbortController();
	let renderer: AssistantMessageRenderer | undefined;
	let renderChain = Promise.resolve();
	const interrupt = () => controller.abort();
	globalThis.process.once("SIGINT", interrupt);
	try {
		const result = await runTurn(process, options.message, {
			signal: controller.signal,
			onEvent: (event) => {
				if (event.type === "extension_ui_request") {
					if (["select", "confirm", "input", "editor"].includes(String(event.method))) {
						renderChain = renderChain.then(() => handleExtensionDialog(event, process.dispatcher, options.env));
					} else {
						renderChain = renderChain.then(() => presentEventWithSource(event, options.env));
					}
					return;
				}
				if (event.type === "message_start") {
					const message = event.message as { role?: string } | undefined;
					if (message?.role === "assistant") {
						renderer = new AssistantMessageRenderer(
							(language) => new BatRenderer(required(options.env.SLAM_BAT, "SLAM_BAT"), undefined, language),
							options.env.SLAM_THINKING_VISIBLE === "1",
						);
					}
				}
				if (event.type === "message_update") {
					const delta = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
					const current = renderer;
					if (delta && current) renderChain = renderChain.then(() => current.write(delta));
				}
				if (event.type === "message_end") {
					const current = renderer;
					renderer = undefined;
					if (current) renderChain = renderChain.then(() => current.end());
				}
				if (!["message_start", "message_update", "message_end"].includes(event.type)) {
					renderChain = renderChain.then(() => presentEventWithSource(event, options.env));
				}
			},
		});
		await renderChain;
		await renderer?.end();
		const state = result.state as {
			sessionFile?: string;
			sessionId: string;
			sessionName?: string;
			thinkingLevel?: string;
			model?: { provider?: string; id?: string };
		};
		const verified = verifiedAttachment(attachment, attachment, state);
		if (options.stateFile) writeState(options.stateFile, state, verified, options.cwd);
		return result.interrupted ? 130 : 0;
	} finally {
		globalThis.process.off("SIGINT", interrupt);
	}
}

async function presentEventWithSource(
	event: Parameters<typeof presentEvent>[0],
	env: NodeJS.ProcessEnv,
): Promise<void> {
	const source = presentEvent(event, (text) => globalThis.process.stderr.write(text));
	if (!source) return;
	const renderer = new BatRenderer(required(env.SLAM_BAT, "SLAM_BAT"), undefined, source.language);
	await renderer.write(source.text);
	await renderer.end();
}

function attachmentFromEnvironment(env: NodeJS.ProcessEnv): ShellAttachment {
	return {
		...(env.SLAM_SESSION_FILE ? { sessionFile: env.SLAM_SESSION_FILE } : {}),
		...(env.SLAM_SESSION_ID ? { sessionId: env.SLAM_SESSION_ID } : {}),
		...(env.SLAM_PROVIDER ? { provider: env.SLAM_PROVIDER } : {}),
		...(env.SLAM_MODEL ? { model: env.SLAM_MODEL } : {}),
	};
}

function writeState(
	path: string,
	state: { sessionName?: string; thinkingLevel?: string },
	attachment: ShellAttachment,
	cwd: string,
): void {
	const record: ShellState = {
		SLAM_ACTIVE: "1",
		SLAM_SESSION_ID: attachment.sessionId ?? "",
		SLAM_SESSION_NAME: state.sessionName ?? "",
		SLAM_SESSION_FILE: attachment.sessionFile ?? "",
		SLAM_SESSION_CWD: cwd,
		SLAM_PROVIDER: attachment.provider ?? "",
		SLAM_MODEL: attachment.model ?? "",
		SLAM_THINKING_LEVEL: state.thinkingLevel ?? "",
		SLAM_MODEL_PENDING: "0",
	};
	writeFileSync(path, encodeShellState(record), { mode: 0o600 });
}

function required(value: string | undefined, name: string): string {
	if (!value) throw new Error(`${name} is not configured`);
	return value;
}

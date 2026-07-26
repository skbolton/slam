import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RequestDispatcher } from "../pi/dispatcher.ts";
import type { RpcEvent } from "../pi/protocol.ts";
import { chooseWithFzf, inputWithFzf } from "./fzf.ts";

export async function handleExtensionDialog(
	event: RpcEvent,
	dispatcher: RequestDispatcher,
	env: NodeJS.ProcessEnv,
): Promise<void> {
	if (event.type !== "extension_ui_request" || typeof event.id !== "string" || typeof event.method !== "string") return;
	const fzf = required(env.SLAM_FZF, "SLAM_FZF");
	const controller = new AbortController();
	const timer = typeof event.timeout === "number" ? setTimeout(() => controller.abort(), event.timeout) : undefined;
	try {
		let response: Record<string, unknown>;
		switch (event.method) {
			case "select": {
				const options = Array.isArray(event.options)
					? event.options.filter((value): value is string => typeof value === "string")
					: [];
				const selected = await chooseWithFzf(
					fzf,
					text(event.title),
					options.map((label, index) => ({ value: String(index), label })),
					controller.signal,
				);
				response = selected === undefined ? { cancelled: true } : { value: options[Number(selected)] };
				break;
			}
			case "confirm": {
				const selected = await chooseWithFzf(
					fzf,
					`${text(event.title)} — ${text(event.message)}`,
					[
						{ value: "yes", label: "Yes" },
						{ value: "no", label: "No" },
					],
					controller.signal,
				);
				response = { confirmed: selected === "yes" };
				break;
			}
			case "input": {
				const value = await inputWithFzf(
					fzf,
					text(event.title),
					typeof event.placeholder === "string" ? event.placeholder : undefined,
					controller.signal,
				);
				response = value === undefined ? { cancelled: true } : { value };
				break;
			}
			case "editor": {
				const value = await editText(text(event.prefill), env, controller.signal);
				response = value === undefined ? { cancelled: true } : { value };
				break;
			}
			default:
				throw new Error(`Unsupported blocking extension UI method: ${event.method}`);
		}
		dispatcher.write({ type: "extension_ui_response", id: event.id, ...response });
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function editText(prefill: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<string | undefined> {
	const editor = env.VISUAL || env.EDITOR;
	if (!editor) return undefined;
	const directory = mkdtempSync(join(tmpdir(), "slam-editor-"));
	const file = join(directory, "input.md");
	try {
		writeFileSync(file, prefill, { mode: 0o600 });
		const [command, ...args] = editor.split(/\s+/).filter(Boolean);
		if (!command) return undefined;
		const code = await new Promise<number | null>((resolve, reject) => {
			const child = spawn(command, [...args, file], { stdio: "inherit", env });
			const abort = () => child.kill("SIGTERM");
			signal.addEventListener("abort", abort, { once: true });
			child.once("error", reject);
			child.once("exit", (exitCode) => {
				signal.removeEventListener("abort", abort);
				resolve(exitCode);
			});
		});
		return !signal.aborted && code === 0 ? readFileSync(file, "utf8") : undefined;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function required(value: string | undefined, name: string): string {
	if (!value) throw new Error(`${name} is not configured`);
	return value;
}

function text(value: unknown): string {
	return value === undefined ? "" : String(value);
}

import { resolve } from "node:path";
import type { PiProcessOptions } from "../pi/process.ts";

export interface ShellAttachment {
	readonly sessionFile?: string;
	readonly sessionId?: string;
	readonly provider?: string;
	readonly model?: string;
}

export interface PiSessionState {
	readonly sessionFile?: string;
	readonly sessionId: string;
	readonly model?: { readonly provider?: string; readonly id?: string };
}

export function sessionProcessOptions(input: {
	readonly executable: string;
	readonly shellCwd: string;
	readonly attachment: ShellAttachment;
	readonly sessionDir?: string;
	readonly env?: NodeJS.ProcessEnv;
}): PiProcessOptions {
	const args: string[] = [];
	if (input.sessionDir) args.push("--session-dir", input.sessionDir);
	if (input.attachment.sessionFile) args.push("--session", resolve(input.attachment.sessionFile));
	if (input.attachment.provider) args.push("--provider", input.attachment.provider);
	if (input.attachment.model) args.push("--model", input.attachment.model);
	return { executable: input.executable, cwd: input.shellCwd, args, ...(input.env ? { env: input.env } : {}) };
}

export function verifiedAttachment(
	previous: ShellAttachment,
	expected: ShellAttachment,
	state: PiSessionState,
): ShellAttachment {
	if (!state.sessionFile) throw new Error("Pi did not return a persistent session file");
	const returnedFile = resolve(state.sessionFile);
	if (expected.sessionFile && returnedFile !== resolve(expected.sessionFile)) {
		throw new Error(`Pi resumed an unexpected session: ${returnedFile}`);
	}
	if (expected.sessionId && state.sessionId !== expected.sessionId) {
		throw new Error(`Pi resumed an unexpected session id: ${state.sessionId}`);
	}
	const provider = state.model?.provider ?? previous.provider;
	const model = state.model?.id ?? previous.model;
	return {
		sessionFile: returnedFile,
		sessionId: state.sessionId,
		...(provider ? { provider } : {}),
		...(model ? { model } : {}),
	};
}

import { existsSync, realpathSync } from "node:fs";
import type { ShellAttachment } from "./coordinator.ts";

export interface AttachmentTransition {
	readonly previous: ShellAttachment;
	readonly target: ShellAttachment;
}

export function beginAttachmentTransition(previous: ShellAttachment, sessionFile: string): AttachmentTransition {
	if (!existsSync(sessionFile)) throw new Error(`Session file does not exist: ${sessionFile}`);
	return { previous, target: { sessionFile: realpathSync(sessionFile) } };
}

export function commitAttachmentTransition(
	_transition: AttachmentTransition,
	verified: ShellAttachment,
): ShellAttachment {
	if (!verified.sessionFile || !verified.sessionId) throw new Error("Verified session state is incomplete");
	return verified;
}

export function rollbackAttachmentTransition(transition: AttachmentTransition): ShellAttachment {
	return transition.previous;
}

export function detachAttachment(): ShellAttachment {
	return {};
}

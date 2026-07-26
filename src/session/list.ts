import { realpathSync } from "node:fs";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";

export interface ListedSession {
	readonly id: string;
	readonly path: string;
	readonly cwd: string;
	readonly name?: string;
	readonly modified: string;
}

export async function listProjectSessions(cwd: string): Promise<ListedSession[]> {
	const sessions = await SessionManager.list(cwd);
	return sessions.map(projectSession);
}

export function resolveProjectSession(sessions: readonly ListedSession[], selector: string): ListedSession {
	const byPath = sessions.find((session) => session.path === selector || session.path === safeRealpath(selector));
	if (byPath) return byPath;
	const exact = sessions.find((session) => session.id === selector);
	if (exact) return exact;
	const prefix = sessions.filter((session) => session.id.startsWith(selector));
	const unique = prefix[0];
	if (prefix.length === 1 && unique) return unique;
	if (prefix.length > 1) throw new Error(`Session selector is ambiguous: ${selector}`);
	throw new Error(`No session found in this directory matching: ${selector}`);
}

function projectSession(session: SessionInfo): ListedSession {
	return {
		id: session.id,
		path: realpathSync(session.path),
		cwd: session.cwd,
		...(session.name ? { name: session.name } : {}),
		modified: session.modified.toISOString(),
	};
}

function safeRealpath(path: string): string | undefined {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

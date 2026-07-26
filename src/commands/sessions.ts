import { listProjectSessions, resolveProjectSession } from "../session/list.ts";
import { PiProcess } from "../pi/process.ts";
import { verifiedAttachment } from "../session/coordinator.ts";
import { encodeShellState, type ShellState } from "../shell/state-record.ts";
import { writeFileSync } from "node:fs";

export async function sessionsCommand(cwd: string): Promise<void> {
	const sessions = await listProjectSessions(cwd);
	for (const session of sessions) {
		process.stdout.write(`${session.id}\t${session.name ?? ""}\t${session.modified}\t${session.path}\n`);
	}
}

export async function attachSessionCommand(
	cwd: string,
	selector: string,
	stateFile: string,
	env: NodeJS.ProcessEnv,
): Promise<void> {
	const selected = resolveProjectSession(await listProjectSessions(cwd), selector);
	const process = new PiProcess({
		executable: required(env.SLAM_PI, "SLAM_PI"),
		cwd,
		args: ["--session", selected.path],
		env,
	});
	try {
		await process.start();
		const response = await process.dispatcher.send({ type: "get_state" });
		const state = response.data as {
			sessionFile?: string;
			sessionId: string;
			sessionName?: string;
			thinkingLevel?: string;
			model?: { provider?: string; id?: string };
		};
		const attachment = verifiedAttachment({}, { sessionFile: selected.path, sessionId: selected.id }, state);
		const record: ShellState = {
			SLAM_ACTIVE: "1",
			SLAM_SESSION_ID: attachment.sessionId ?? "",
			SLAM_SESSION_NAME: state.sessionName ?? selected.name ?? "",
			SLAM_SESSION_FILE: attachment.sessionFile ?? "",
			SLAM_SESSION_CWD: selected.cwd,
			SLAM_PROVIDER: attachment.provider ?? "",
			SLAM_MODEL: attachment.model ?? "",
			SLAM_THINKING_LEVEL: state.thinkingLevel ?? "",
			SLAM_MODEL_PENDING: "0",
		};
		writeFileSync(stateFile, encodeShellState(record), { mode: 0o600 });
	} finally {
		await process.stop();
	}
}

function required(value: string | undefined, name: string): string {
	if (!value) throw new Error(`${name} is not configured`);
	return value;
}

export async function resolveSessionCommand(cwd: string, selector: string): Promise<void> {
	const selected = resolveProjectSession(await listProjectSessions(cwd), selector);
	process.stdout.write(`${selected.id}\t${selected.path}\n`);
}

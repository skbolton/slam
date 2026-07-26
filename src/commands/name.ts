import { PiProcess } from "../pi/process.ts";
import { verifiedAttachment, type ShellAttachment } from "../session/coordinator.ts";
import { encodeShellState, type ShellState } from "../shell/state-record.ts";
import { writeFileSync } from "node:fs";

export async function nameSessionCommand(name: string, stateFile: string, env: NodeJS.ProcessEnv): Promise<void> {
	const previous: ShellAttachment = {
		...(env.SLAM_SESSION_FILE ? { sessionFile: env.SLAM_SESSION_FILE } : {}),
		...(env.SLAM_SESSION_ID ? { sessionId: env.SLAM_SESSION_ID } : {}),
	};
	if (!previous.sessionFile) throw new Error("no session is attached");
	const process = new PiProcess({
		executable: required(env.SLAM_PI, "SLAM_PI"),
		cwd: env.SLAM_SESSION_CWD ?? processCwd(),
		args: ["--session", previous.sessionFile],
		env,
	});
	try {
		await process.start();
		await process.dispatcher.send({ type: "set_session_name", name });
		const response = await process.dispatcher.send({ type: "get_state" });
		const state = response.data as {
			sessionFile?: string;
			sessionId: string;
			sessionName?: string;
			thinkingLevel?: string;
			model?: { provider?: string; id?: string };
		};
		const attachment = verifiedAttachment(previous, previous, state);
		const record: ShellState = {
			SLAM_ACTIVE: "1",
			SLAM_SESSION_ID: attachment.sessionId ?? "",
			SLAM_SESSION_NAME: state.sessionName ?? name,
			SLAM_SESSION_FILE: attachment.sessionFile ?? "",
			SLAM_SESSION_CWD: env.SLAM_SESSION_CWD ?? "",
			SLAM_PROVIDER: state.model?.provider ?? env.SLAM_PROVIDER ?? "",
			SLAM_MODEL: state.model?.id ?? env.SLAM_MODEL ?? "",
			SLAM_THINKING_LEVEL: state.thinkingLevel ?? env.SLAM_THINKING_LEVEL ?? "",
			SLAM_MODEL_PENDING: "0",
		};
		writeFileSync(stateFile, encodeShellState(record), { mode: 0o600 });
	} finally {
		await process.stop();
	}
}

function processCwd(): string {
	return globalThis.process.cwd();
}

function required(value: string | undefined, name: string): string {
	if (!value) throw new Error(`${name} is not configured`);
	return value;
}

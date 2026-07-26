import { writeFileSync } from "node:fs";
import { PiProcess } from "../pi/process.ts";
import { encodeShellState, type ShellState } from "../shell/state-record.ts";
import { chooseWithFzf } from "../ui/fzf.ts";

interface Model {
	readonly provider: string;
	readonly id: string;
	readonly name?: string;
}

export async function modelsCommand(stateFile: string, env: NodeJS.ProcessEnv): Promise<void> {
	const attached = Boolean(env.SLAM_SESSION_FILE);
	const args = attached ? ["--session", env.SLAM_SESSION_FILE as string] : ["--no-session"];
	const process = new PiProcess({ executable: required(env.SLAM_PI, "SLAM_PI"), cwd: processCwd(), args, env });
	try {
		await process.start();
		const response = await process.dispatcher.send({ type: "get_available_models" });
		const models = ((response.data as { models?: Model[] } | undefined)?.models ?? []).filter(
			(model) => model.provider && model.id,
		);
		const choices = models.map((model, index) => ({
			value: String(index),
			label: `${model.provider}/${model.id}${model.name ? ` — ${model.name}` : ""}`,
		}));
		const selected = await chooseWithFzf(required(env.SLAM_FZF, "SLAM_FZF"), "Select model", choices);
		if (selected === undefined) return;
		const model = models[Number(selected)];
		if (!model) throw new Error("Fzf returned an unknown model selection");

		if (attached) {
			await process.dispatcher.send({ type: "set_model", provider: model.provider, modelId: model.id });
			const stateResponse = await process.dispatcher.send({ type: "get_state" });
			const state = stateResponse.data as {
				sessionFile?: string;
				sessionId?: string;
				sessionName?: string;
				thinkingLevel?: string;
			};
			writeState(stateFile, env, model, state, false);
		} else {
			writeState(stateFile, env, model, {}, true);
		}
	} finally {
		await process.stop();
	}
}

function writeState(
	path: string,
	env: NodeJS.ProcessEnv,
	model: Model,
	state: { sessionFile?: string; sessionId?: string; sessionName?: string; thinkingLevel?: string },
	pending: boolean,
): void {
	const record: ShellState = {
		SLAM_ACTIVE: pending ? "0" : "1",
		SLAM_SESSION_ID: state.sessionId ?? env.SLAM_SESSION_ID ?? "",
		SLAM_SESSION_NAME: state.sessionName ?? env.SLAM_SESSION_NAME ?? "",
		SLAM_SESSION_FILE: state.sessionFile ?? env.SLAM_SESSION_FILE ?? "",
		SLAM_SESSION_CWD: env.SLAM_SESSION_CWD ?? "",
		SLAM_PROVIDER: model.provider,
		SLAM_MODEL: model.id,
		SLAM_THINKING_LEVEL: state.thinkingLevel ?? env.SLAM_THINKING_LEVEL ?? "",
		SLAM_MODEL_PENDING: pending ? "1" : "0",
	};
	writeFileSync(path, encodeShellState(record), { mode: 0o600 });
}

function required(value: string | undefined, name: string): string {
	if (!value) throw new Error(`${name} is not configured`);
	return value;
}

function processCwd(): string {
	return globalThis.process.cwd();
}

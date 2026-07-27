import { BUILD_INFO } from "../build-info.generated.ts";

export function infoCommand(env: NodeJS.ProcessEnv, shellCwd: string): void {
	const attached = env.SLAM_ACTIVE === "1";
	const pending = env.SLAM_MODEL_PENDING === "1";
	const lines = [
		`Slam: ${BUILD_INFO.slamVersion}`,
		`Pi: ${BUILD_INFO.piVersion}`,
		`Pi package revision: ${BUILD_INFO.piPackageRevision}`,
		`Session: ${attached ? "attached" : "unattached"}`,
		`Shell cwd: ${shellCwd}`,
	];
	if (attached) {
		lines.push(
			`Session ID: ${env.SLAM_SESSION_ID ?? ""}`,
			`Session name: ${env.SLAM_SESSION_NAME ?? ""}`,
			`Session file: ${env.SLAM_SESSION_FILE ?? ""}`,
			`Session cwd: ${env.SLAM_SESSION_CWD ?? ""}`,
		);
	}
	if (env.SLAM_PROVIDER || env.SLAM_MODEL) {
		lines.push(`Model: ${env.SLAM_PROVIDER ?? ""}/${env.SLAM_MODEL ?? ""}${pending ? " (pending)" : ""}`);
	}
	if (attached) lines.push(`Thinking: ${env.SLAM_THINKING_LEVEL ?? ""}`);
	lines.push(`Thinking display: ${env.SLAM_THINKING_VISIBLE === "1" ? "on" : "off"}`);
	process.stdout.write(`${lines.join("\n")}\n`);
}

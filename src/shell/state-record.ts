export const SHELL_STATE_KEYS = [
	"SLAM_ACTIVE",
	"SLAM_SESSION_ID",
	"SLAM_SESSION_NAME",
	"SLAM_SESSION_FILE",
	"SLAM_SESSION_CWD",
	"SLAM_PROVIDER",
	"SLAM_MODEL",
	"SLAM_THINKING_LEVEL",
	"SLAM_MODEL_PENDING",
] as const;

export type ShellStateKey = (typeof SHELL_STATE_KEYS)[number];
export type ShellState = Record<ShellStateKey, string>;

export function encodeShellState(state: ShellState): string {
	return [
		"SLAM_STATE_V1",
		...SHELL_STATE_KEYS.map((key) => `${key}=${Buffer.from(state[key], "utf8").toString("base64")}`),
		"",
	].join("\n");
}

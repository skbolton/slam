import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface IsolatedPiEnvironment {
	readonly root: string;
	readonly configDir: string;
	readonly sessionDir: string;
	readonly env: NodeJS.ProcessEnv;
	cleanup(): void;
}

export function createIsolatedPiEnvironment(): IsolatedPiEnvironment {
	const root = mkdtempSync(join(tmpdir(), "slam-test-pi-"));
	const configDir = join(root, "config");
	const sessionDir = join(root, "sessions");
	return {
		root,
		configDir,
		sessionDir,
		env: {
			...process.env,
			HOME: root,
			PI_CODING_AGENT_DIR: configDir,
			PI_CODING_AGENT_SESSION_DIR: sessionDir,
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
			PI_TELEMETRY: "0",
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}

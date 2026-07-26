#!/usr/bin/env node

import { BUILD_INFO } from "./build-info.generated.ts";
import { messageCommand } from "./commands/message.ts";
import { attachSessionCommand, resolveSessionCommand, sessionsCommand } from "./commands/sessions.ts";
import { nameSessionCommand } from "./commands/name.ts";
import { modelsCommand } from "./commands/models.ts";
import { infoCommand } from "./commands/info.ts";

function versionText(): string {
	return [
		`slam ${BUILD_INFO.slamVersion}`,
		`pi ${BUILD_INFO.piVersion}`,
		`pi package revision ${BUILD_INFO.piPackageRevision}`,
	].join("\n");
}

const [command] = process.argv.slice(2);
if (command === "--version" || command === "-V") {
	process.stdout.write(`${versionText()}\n`);
} else if (command === "message") {
	const separator = process.argv.indexOf("--");
	const message = separator >= 0 ? process.argv[separator + 1] : undefined;
	if (!message) {
		process.stderr.write("slam: message is required\n");
		process.exitCode = 2;
	} else {
		messageCommand({
			message,
			...(process.env.SLAM_STATE_FILE ? { stateFile: process.env.SLAM_STATE_FILE } : {}),
			cwd: process.cwd(),
			env: process.env,
		})
			.then((status) => {
				process.exit(status);
			})
			.catch((error) => {
				process.stderr.write(`slam: ${error instanceof Error ? error.message : String(error)}\n`);
				process.exit(1);
			});
	}
} else if (command === "sessions") {
	sessionsCommand(process.cwd()).catch(failCommand);
} else if (command === "resolve-session") {
	const selector = process.argv[3];
	if (!selector) failCommand(new Error("session selector is required"));
	else resolveSessionCommand(process.cwd(), selector).catch(failCommand);
} else if (command === "attach") {
	const selector = process.argv[3];
	const stateFile = process.env.SLAM_STATE_FILE;
	if (!selector || !stateFile) failCommand(new Error("session selector and state file are required"));
	else attachSessionCommand(process.cwd(), selector, stateFile, process.env).catch(failCommand);
} else if (command === "name") {
	const name = process.argv[3];
	const stateFile = process.env.SLAM_STATE_FILE;
	if (!name || !stateFile) failCommand(new Error("session name and state file are required"));
	else nameSessionCommand(name, stateFile, process.env).catch(failCommand);
} else if (command === "models") {
	const stateFile = process.env.SLAM_STATE_FILE;
	if (!stateFile) failCommand(new Error("state file is required"));
	else modelsCommand(stateFile, process.env).catch(failCommand);
} else if (command === "info") {
	infoCommand(process.env, process.cwd());
} else if (command !== undefined) {
	process.stderr.write(`slam: unknown option: ${command}\n`);
	process.exitCode = 2;
}

function failCommand(error: unknown): void {
	process.stderr.write(`slam: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}

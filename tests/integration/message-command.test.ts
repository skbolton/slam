import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { messageCommand } from "../../src/commands/message.ts";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("runs one prompt, streams text, and writes parent-shell state", async () => {
	const directory = mkdtempSync(join(tmpdir(), "slam-message-command-"));
	directories.push(directory);
	const scenario = join(directory, "scenario.json");
	const stateFile = join(directory, "state");
	const fakePi = join(directory, "pi");
	const fakeBat = join(directory, "bat");
	const rendered = join(directory, "rendered");
	writeFileSync(
		fakePi,
		`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --experimental-strip-types ${JSON.stringify(resolve("tests/fixtures/fake-pi-rpc.ts"))} "$@" ${JSON.stringify(scenario)}\n`,
		{ mode: 0o700 },
	);
	writeFileSync(fakeBat, `#!/bin/sh\ncat > ${JSON.stringify(rendered)}\n`, { mode: 0o700 });
	writeFileSync(
		scenario,
		JSON.stringify([
			{ type: "await", command: "prompt", response: { type: "response", command: "prompt", success: true } },
			{ type: "event", value: { type: "message_start", message: { role: "assistant", content: [] } } },
			{
				type: "event",
				value: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } },
			},
			{ type: "event", value: { type: "message_end", message: { role: "assistant" } } },
			{ type: "event", value: { type: "agent_settled" } },
			{
				type: "await",
				command: "get_state",
				response: {
					type: "response",
					command: "get_state",
					success: true,
					data: {
						sessionFile: join(directory, "session.jsonl"),
						sessionId: "one",
						thinkingLevel: "off",
						model: { provider: "p", id: "m" },
					},
				},
			},
		]),
	);
	const status = await messageCommand({
		message: "hi",
		stateFile,
		cwd: directory,
		env: {
			...process.env,
			SLAM_PI: fakePi,
			SLAM_BAT: fakeBat,
			SLAM_SESSION_FILE: "",
			SLAM_SESSION_ID: "",
		},
	});
	expect(status).toBe(0);
	expect(readFileSync(rendered, "utf8")).toBe("hello");
	const state = readFileSync(stateFile, "utf8");
	expect(state).toContain("SLAM_STATE_V1");
});

it("renders visible thinking as a JavaScript multiline comment", async () => {
	const directory = mkdtempSync(join(tmpdir(), "slam-message-thinking-"));
	directories.push(directory);
	const scenario = join(directory, "scenario.json");
	const fakePi = join(directory, "pi");
	const fakeBat = join(directory, "bat");
	const rendered = join(directory, "rendered");
	writeFileSync(
		fakePi,
		`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --experimental-strip-types ${JSON.stringify(resolve("tests/fixtures/fake-pi-rpc.ts"))} "$@" ${JSON.stringify(scenario)}\n`,
		{ mode: 0o700 },
	);
	writeFileSync(
		fakeBat,
		`#!/bin/sh\nprintf '%s\\n' "$1" >> ${JSON.stringify(rendered)}\ncat >> ${JSON.stringify(rendered)}\n`,
		{
			mode: 0o700,
		},
	);
	writeFileSync(
		scenario,
		JSON.stringify([
			{ type: "await", command: "prompt", response: { type: "response", command: "prompt", success: true } },
			{ type: "event", value: { type: "message_start", message: { role: "assistant", content: [] } } },
			{
				type: "event",
				value: { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "First " } },
			},
			{
				type: "event",
				value: { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "line\nSecond" } },
			},
			{
				type: "event",
				value: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Answer" } },
			},
			{ type: "event", value: { type: "message_end", message: { role: "assistant" } } },
			{ type: "event", value: { type: "agent_settled" } },
			{
				type: "await",
				command: "get_state",
				response: {
					type: "response",
					command: "get_state",
					success: true,
					data: { sessionFile: join(directory, "session.jsonl"), sessionId: "one" },
				},
			},
		]),
	);

	await messageCommand({
		message: "hi",
		cwd: directory,
		env: { ...process.env, SLAM_PI: fakePi, SLAM_BAT: fakeBat, SLAM_THINKING_VISIBLE: "1" },
	});

	expect(readFileSync(rendered, "utf8")).toBe(
		"--language=js\n/* First line\nSecond */\n\n--language=markdown\nAnswer",
	);
});

it("omits thinking when display is off", async () => {
	const directory = mkdtempSync(join(tmpdir(), "slam-message-hidden-thinking-"));
	directories.push(directory);
	const scenario = join(directory, "scenario.json");
	const fakePi = join(directory, "pi");
	const fakeBat = join(directory, "bat");
	const rendered = join(directory, "rendered");
	writeFileSync(
		fakePi,
		`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --experimental-strip-types ${JSON.stringify(resolve("tests/fixtures/fake-pi-rpc.ts"))} "$@" ${JSON.stringify(scenario)}\n`,
		{ mode: 0o700 },
	);
	writeFileSync(fakeBat, `#!/bin/sh\ncat > ${JSON.stringify(rendered)}\n`, { mode: 0o700 });
	writeFileSync(
		scenario,
		JSON.stringify([
			{ type: "await", command: "prompt", response: { type: "response", command: "prompt", success: true } },
			{ type: "event", value: { type: "message_start", message: { role: "assistant", content: [] } } },
			{
				type: "event",
				value: { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Hidden" } },
			},
			{
				type: "event",
				value: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Answer" } },
			},
			{ type: "event", value: { type: "message_end", message: { role: "assistant" } } },
			{ type: "event", value: { type: "agent_settled" } },
			{
				type: "await",
				command: "get_state",
				response: {
					type: "response",
					command: "get_state",
					success: true,
					data: { sessionFile: join(directory, "session.jsonl"), sessionId: "one" },
				},
			},
		]),
	);

	await messageCommand({
		message: "hi",
		cwd: directory,
		env: { ...process.env, SLAM_PI: fakePi, SLAM_BAT: fakeBat, SLAM_THINKING_VISIBLE: "0" },
	});

	expect(readFileSync(rendered, "utf8")).toBe("Answer");
});

it("syntax highlights Bash tool calls without Markdown fences", async () => {
	const directory = mkdtempSync(join(tmpdir(), "slam-message-tool-source-"));
	directories.push(directory);
	const scenario = join(directory, "scenario.json");
	const fakePi = join(directory, "pi");
	const fakeBat = join(directory, "bat");
	const rendered = join(directory, "rendered");
	writeFileSync(
		fakePi,
		`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --experimental-strip-types ${JSON.stringify(resolve("tests/fixtures/fake-pi-rpc.ts"))} "$@" ${JSON.stringify(scenario)}\n`,
		{ mode: 0o700 },
	);
	writeFileSync(
		fakeBat,
		`#!/bin/sh\nprintf '%s\\n' "$1" >> ${JSON.stringify(rendered)}\ncat >> ${JSON.stringify(rendered)}\n`,
		{ mode: 0o700 },
	);
	writeFileSync(
		scenario,
		JSON.stringify([
			{ type: "await", command: "prompt", response: { type: "response", command: "prompt", success: true } },
			{
				type: "event",
				value: { type: "tool_execution_start", toolName: "bash", args: { command: "npm test\nprintf done" } },
			},
			{ type: "event", value: { type: "tool_execution_end", toolName: "bash", isError: false } },
			{ type: "event", value: { type: "agent_settled" } },
			{
				type: "await",
				command: "get_state",
				response: {
					type: "response",
					command: "get_state",
					success: true,
					data: { sessionFile: join(directory, "session.jsonl"), sessionId: "one" },
				},
			},
		]),
	);

	const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	try {
		await messageCommand({
			message: "run tests",
			cwd: directory,
			env: { ...process.env, SLAM_PI: fakePi, SLAM_BAT: fakeBat },
		});
		expect(stderr.mock.calls.map((call) => String(call[0])).join("")).toBe(" bash\n✓ bash\n");
	} finally {
		stderr.mockRestore();
	}
	expect(readFileSync(rendered, "utf8")).toBe("--language=bash\nnpm test\nprintf done");
});

it("the message CLI exits immediately after the completed command", () => {
	const source = readFileSync(resolve("src/index.ts"), "utf8");
	expect(source).toContain("process.exit(status)");
	expect(source).toContain("process.exit(1)");
});

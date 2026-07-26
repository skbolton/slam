import { readFile } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

export type FakeRpcStep =
	| { type: "await"; command: string; response?: Record<string, unknown> }
	| { type: "event"; value: Record<string, unknown>; fragments?: number[] }
	| { type: "stderr"; value: string }
	| { type: "delay"; milliseconds: number }
	| { type: "exit"; code: number };

const scenarioArgument = process.argv.at(-1);
if (!scenarioArgument) throw new Error("fake-pi-rpc requires a scenario path");
const scenarioPath: string = scenarioArgument;

const inbox: Record<string, unknown>[] = [];
const wakeups = new Set<() => void>();
const decoder = new StringDecoder("utf8");
let buffer = "";

process.stdin.on("data", (chunk: Buffer) => {
	buffer += decoder.write(chunk);
	drainLines();
});
process.stdin.on("end", () => {
	buffer += decoder.end();
	drainLines();
});

function drainLines(): void {
	while (true) {
		const newline = buffer.indexOf("\n");
		if (newline < 0) return;
		const line = buffer.slice(0, newline).replace(/\r$/, "");
		buffer = buffer.slice(newline + 1);
		if (!line) continue;
		inbox.push(JSON.parse(line) as Record<string, unknown>);
		for (const wake of wakeups) wake();
		wakeups.clear();
	}
}

async function nextCommand(command: string): Promise<Record<string, unknown>> {
	while (true) {
		const index = inbox.findIndex((record) => record.type === command);
		if (index >= 0) {
			const [record] = inbox.splice(index, 1);
			if (record) return record;
		}
		await new Promise<void>((resolve) => wakeups.add(resolve));
	}
}

async function writeFragments(value: Record<string, unknown>, sizes?: number[]): Promise<void> {
	const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
	let offset = 0;
	for (const size of sizes ?? [bytes.length]) {
		if (offset >= bytes.length) break;
		process.stdout.write(bytes.subarray(offset, offset + size));
		offset += size;
		await new Promise((resolve) => setImmediate(resolve));
	}
	if (offset < bytes.length) process.stdout.write(bytes.subarray(offset));
}

async function main(): Promise<void> {
	const steps = JSON.parse(await readFile(scenarioPath, "utf8")) as FakeRpcStep[];
	for (const step of steps) {
		switch (step.type) {
			case "await": {
				const command = await nextCommand(step.command);
				if (step.response) await writeFragments({ ...step.response, id: command.id });
				break;
			}
			case "event":
				await writeFragments(step.value, step.fragments);
				break;
			case "stderr":
				process.stderr.write(step.value);
				break;
			case "delay":
				await new Promise((resolve) => setTimeout(resolve, step.milliseconds));
				break;
			case "exit":
				process.exit(step.code);
		}
	}
}

main().catch((error) => {
	process.stderr.write(`fake-pi-rpc: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 2;
});

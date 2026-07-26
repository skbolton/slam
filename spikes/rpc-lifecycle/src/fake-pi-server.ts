import { readFile } from "node:fs/promises";
import { createJsonlLineReader, serializeJsonLine } from "./jsonl.ts";

type Step =
	| { kind: "delay"; ms: number }
	| { kind: "wait-for-stdin"; match: Record<string, unknown>; respond?: Record<string, unknown> }
	| { kind: "write"; record: Record<string, unknown> }
	| { kind: "write-fragmented"; record: Record<string, unknown>; sizes: number[] }
	| { kind: "write-stderr"; text: string }
	| { kind: "exit"; code: number };

const inbox: Record<string, unknown>[] = [];
const inboxWaiters = new Set<() => void>();

const reader = createJsonlLineReader((line) => {
	if (!line) return;
	try {
		const parsed = JSON.parse(line);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
		inbox.push(parsed as Record<string, unknown>);
		for (const wake of inboxWaiters) wake();
		inboxWaiters.clear();
	} catch (error) {
		process.stderr.write(`fake-pi: invalid stdin record: ${(error as Error).message}\n`);
	}
});
process.stdin.on("data", (chunk: Buffer) => reader.push(chunk));
process.stdin.on("end", () => reader.end());

async function waitForRecord(match: Record<string, unknown>): Promise<Record<string, unknown>> {
	while (true) {
		const index = inbox.findIndex((record) => Object.entries(match).every(([key, value]) => record[key] === value));
		if (index >= 0) return inbox.splice(index, 1)[0]!;
		await new Promise<void>((resolve) => inboxWaiters.add(resolve));
	}
}

async function main(): Promise<void> {
	const scenarioPath = process.argv[2];
	if (!scenarioPath) throw new Error("missing scenario path");
	const steps = JSON.parse(await readFile(scenarioPath, "utf8")) as Step[];

	for (const step of steps) {
		switch (step.kind) {
			case "delay":
				await new Promise((resolve) => setTimeout(resolve, step.ms));
				break;
			case "wait-for-stdin": {
				const command = await waitForRecord(step.match);
				if (step.respond) process.stdout.write(serializeJsonLine({ ...step.respond, id: command.id }));
				break;
			}
			case "write":
				process.stdout.write(serializeJsonLine(step.record));
				break;
			case "write-fragmented": {
				const bytes = Buffer.from(serializeJsonLine(step.record));
				let offset = 0;
				for (const size of step.sizes) {
					if (offset >= bytes.length) break;
					process.stdout.write(bytes.subarray(offset, offset + size));
					offset += size;
					await new Promise((resolve) => setTimeout(resolve, 2));
				}
				if (offset < bytes.length) process.stdout.write(bytes.subarray(offset));
				break;
			}
			case "write-stderr":
				process.stderr.write(step.text);
				break;
			case "exit":
				process.exit(step.code);
		}
	}
}

main().catch((error) => {
	process.stderr.write(`fake-pi: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(2);
});

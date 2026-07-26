import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient, type RpcEvent } from "./rpc-client.ts";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const scenarioPath = process.argv[2];
if (!scenarioPath) throw new Error("missing scenario path");

async function main(): Promise<void> {
	const events: RpcEvent[] = [];
	const client = new RpcClient({
		spawn: {
			command: process.execPath,
			args: ["--experimental-strip-types", "--no-warnings", join(sourceDir, "fake-pi-server.ts"), scenarioPath],
		},
		onEvent: (event) => events.push(event),
	});
	await client.start();
	const settled = client.untilEvent("agent_settled", { timeoutMs: 5_000 });
	await client.send({ type: "prompt", message: "wait for interruption" });

	let handling = false;
	const interrupted = new Promise<void>((resolve) => {
		process.on("SIGINT", () => {
			if (handling) return;
			handling = true;
			void (async () => {
				await client.send({ type: "abort" });
				await settled;
				const exit = await client.stop();
				process.stdout.write(`${JSON.stringify({ ok: true, events: events.map((event) => event.type), exit })}\n`);
				resolve();
			})().catch((error) => {
				process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
				process.exitCode = 1;
				resolve();
			});
		});
	});
	process.stdout.write("READY\n");
	await interrupted;
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
	process.exitCode = 1;
});

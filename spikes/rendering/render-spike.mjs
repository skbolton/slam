import { spawn } from "node:child_process";
import { once } from "node:events";

export async function renderFragments({
	bat = process.env.SLAM_SPIKE_BAT ?? "bat",
	batArgsPrefix = [],
	fragments,
	delayMs = 20,
	stdout = process.stdout,
	stderr = process.stderr,
	env = process.env,
}) {
	const child = spawn(bat, [...batArgsPrefix, "--language=markdown", "--paging=never", "--color=always", "--style=plain"], {
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	child.stdout.pipe(stdout, { end: false });
	child.stderr.pipe(stderr, { end: false });

	const spawnError = new Promise((_, reject) => child.once("error", reject));
	let stdinError;
	child.stdin.on("error", (error) => { stdinError = error; });
	const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
	try {
		await Promise.race([once(child, "spawn"), spawnError]);
	} catch (error) {
		child.stdout?.destroy();
		child.stderr?.destroy();
		throw error;
	}

	try {
		for (const fragment of fragments) {
			if (!child.stdin.writable || child.stdin.destroyed) throw new Error("Bat stdin closed during rendering");
			await new Promise((resolve, reject) => {
				child.stdin.write(fragment, (error) => error ? reject(error) : resolve());
			});
			if (delayMs > 0) await sleep(delayMs);
		}
		child.stdin.end();
	} catch (error) {
		child.stdin.destroy();
		await exited;
		throw error;
	}

	const result = await exited;
	if (stdinError && result.code === 0) throw stdinError;
	if (result.code !== 0) {
		throw new Error(`Bat exited unsuccessfully (code=${result.code} signal=${result.signal})`);
	}
	return result;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const fragments = [
		"# Streamed response\n\n",
		"This arrives in ",
		"several fragments.\n\n```js\n",
		"console.log('hello');\n",
		"```\n",
	];
	renderFragments({ fragments }).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}

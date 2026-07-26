import { spawn } from "node:child_process";

export interface FzfChoice {
	readonly value: string;
	readonly label: string;
}

export async function chooseWithFzf(
	executable: string,
	title: string,
	choices: readonly FzfChoice[],
	signal?: AbortSignal,
): Promise<string | undefined> {
	const child = spawn(
		executable,
		[
			"--read0",
			"--print0",
			"--no-multi",
			"--height=~50%",
			"--border",
			`--border-label=${title}`,
			"--delimiter=\t",
			"--with-nth=2..",
			"--accept-nth=1",
		],
		{ stdio: ["pipe", "pipe", "inherit"] },
	);
	const abort = () => child.kill("SIGTERM");
	signal?.addEventListener("abort", abort, { once: true });
	let output = Buffer.alloc(0);
	child.stdout.on("data", (chunk: Buffer) => {
		output = Buffer.concat([output, chunk]);
	});
	signal?.removeEventListener("abort", abort);
	if (signal?.aborted) return undefined;
	for (const choice of choices) child.stdin.write(`${choice.value}\t${choice.label}\0`);
	child.stdin.end();
	const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
	if (exit.code === 130) return undefined;
	if (exit.code !== 0) throw new Error(`Fzf exited unsuccessfully (code=${exit.code} signal=${exit.signal})`);
	return output.toString("utf8").replace(/\0$/, "");
}

export async function inputWithFzf(
	executable: string,
	title: string,
	placeholder?: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const child = spawn(
		executable,
		[
			"--disabled",
			"--print-query",
			"--no-multi",
			"--height=~20%",
			"--border",
			`--border-label=${title}`,
			...(placeholder ? [`--ghost=${placeholder}`] : []),
			"--bind=enter:accept",
		],
		{ stdio: ["pipe", "pipe", "inherit"] },
	);
	const abort = () => child.kill("SIGTERM");
	signal?.addEventListener("abort", abort, { once: true });
	child.stdin.end();
	let output = "";
	child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
	const code = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	});
	signal?.removeEventListener("abort", abort);
	if (signal?.aborted) return undefined;
	if (code === 130) return undefined;
	if (code !== 0) throw new Error(`Fzf exited unsuccessfully (code=${code})`);
	return output.replace(/\r?\n$/, "");
}

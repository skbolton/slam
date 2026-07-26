import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createJsonlDecoder, encodeJsonlRecord } from "./jsonl.ts";
import type { RpcEvent } from "./protocol.ts";
import { RequestDispatcher } from "./dispatcher.ts";

export interface PiProcessOptions {
	readonly executable: string;
	readonly executableArgs?: readonly string[];
	readonly cwd: string;
	readonly args?: readonly string[];
	readonly env?: NodeJS.ProcessEnv;
	readonly onEvent?: (event: RpcEvent) => void;
	readonly onStderr?: (text: string) => void;
}

export class PiProcess {
	readonly dispatcher: RequestDispatcher;
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly eventListeners = new Set<(event: RpcEvent) => void>();
	private readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	private exitResult: { code: number | null; signal: NodeJS.Signals | null } | undefined;

	constructor(options: PiProcessOptions) {
		this.child = spawn(
			options.executable,
			[...(options.executableArgs ?? []), "--mode", "rpc", ...(options.args ?? [])],
			{
				cwd: options.cwd,
				env: { ...process.env, ...options.env },
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		this.dispatcher = new RequestDispatcher({
			write: (command) => this.child.stdin.write(encodeJsonlRecord(command)),
			onEvent: (event) => {
				options.onEvent?.(event);
				for (const listener of this.eventListeners) listener(event);
			},
		});
		const decoder = createJsonlDecoder((record) => this.dispatcher.dispatch(record));
		this.child.stdout.on("data", (chunk: Buffer) => {
			try {
				decoder.push(chunk);
			} catch (error) {
				this.protocolFailure(error);
			}
		});
		this.child.stdout.on("end", () => {
			try {
				decoder.end();
			} catch (error) {
				this.protocolFailure(error);
			}
		});
		this.child.stderr.on("data", (chunk: Buffer) => options.onStderr?.(chunk.toString("utf8")));
		this.exited = new Promise((resolve) => {
			this.child.once("exit", (code, signal) => {
				this.exitResult = { code, signal };
				this.dispatcher.fail(new Error(`Pi process exited (code=${code} signal=${signal})`));
				resolve(this.exitResult);
			});
		});
	}

	get pid(): number | undefined {
		return this.child.pid;
	}

	onEvent(listener: (event: RpcEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	async start(timeoutMs = 10_000): Promise<void> {
		await Promise.race([
			new Promise<void>((resolve, reject) => {
				this.child.once("spawn", resolve);
				this.child.once("error", reject);
			}),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Timed out starting Pi process")), timeoutMs),
			),
		]);
		if (this.exitResult) throw new Error(`Pi process exited during startup (code=${this.exitResult.code})`);
	}

	async stop(timeoutMs = 5_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
		if (this.exitResult) return this.exitResult;
		this.child.stdin.end();
		let result = await raceExit(this.exited, Math.min(timeoutMs, 25));
		if (result) return result;
		this.child.kill("SIGTERM");
		result = await raceExit(this.exited, Math.max(1, timeoutMs - 25));
		if (result) return result;
		this.child.kill("SIGKILL");
		return this.exited;
	}

	private protocolFailure(error: unknown): void {
		const failure = error instanceof Error ? error : new Error(String(error));
		this.dispatcher.fail(failure);
		if (!this.exitResult) this.child.kill("SIGTERM");
	}
}

async function raceExit<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
	return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs))]);
}

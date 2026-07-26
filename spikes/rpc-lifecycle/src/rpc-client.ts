import { spawn, type ChildProcess } from "node:child_process";
import { createJsonlLineReader, serializeJsonLine } from "./jsonl.ts";

export interface SpawnArgs {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
}

export interface RpcEvent {
	readonly type: string;
	readonly raw: Record<string, unknown>;
}

export interface RpcResponse {
	readonly type: "response";
	readonly id?: string;
	readonly command: string;
	readonly success: boolean;
	readonly error?: string;
	readonly data?: unknown;
	readonly raw: Record<string, unknown>;
}

export interface RpcClientOptions {
	readonly spawn: SpawnArgs;
	readonly startupTimeoutMs?: number;
	readonly defaultResponseTimeoutMs?: number;
	readonly onEvent?: (event: RpcEvent) => void;
	readonly onParseError?: (line: string, error: Error) => void;
	readonly onUnmappedResponse?: (response: RpcResponse) => void;
}

interface PendingRequest {
	readonly command: string;
	readonly timer: NodeJS.Timeout;
	resolve(response: RpcResponse): void;
	reject(error: Error): void;
}

interface EventWaiter {
	readonly type: string;
	readonly predicate?: (event: RpcEvent) => boolean;
	readonly timer: NodeJS.Timeout;
	resolve(event: RpcEvent): void;
	reject(error: Error): void;
}

interface ExitResult {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
}

export class RpcClient {
	readonly spawnStartedAt = Date.now();
	firstReadAt: number | undefined;

	private readonly child: ChildProcess;
	private readonly options: RpcClientOptions;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly eventWaiters = new Set<EventWaiter>();
	private readonly stderrChunks: Buffer[] = [];
	private readonly spawned: Promise<void>;
	private readonly exited: Promise<ExitResult>;
	private exitResult: ExitResult | undefined;
	private nextRequestId = 0;

	constructor(options: RpcClientOptions) {
		this.options = options;
		this.child = spawn(options.spawn.command, [...options.spawn.args], {
			cwd: options.spawn.cwd,
			env: { ...process.env, ...(options.spawn.env ?? {}) },
			stdio: ["pipe", "pipe", "pipe"],
		});

		const reader = createJsonlLineReader((line) => this.handleLine(line));
		this.child.stdout?.on("data", (chunk: Buffer) => {
			this.firstReadAt ??= Date.now();
			reader.push(chunk);
		});
		this.child.stdout?.on("end", () => reader.end());
		this.child.stderr?.on("data", (chunk: Buffer) => this.stderrChunks.push(chunk));

		this.spawned = new Promise((resolve, reject) => {
			this.child.once("spawn", resolve);
			this.child.once("error", reject);
		});
		this.exited = new Promise((resolve) => {
			this.child.once("exit", (code, signal) => {
				const result = { code, signal };
				this.exitResult = result;
				this.rejectOutstanding(new Error(this.exitMessage(result)));
				resolve(result);
			});
		});
	}

	get pid(): number {
		return this.child.pid ?? -1;
	}

	async start(): Promise<void> {
		const timeoutMs = this.options.startupTimeoutMs ?? 10_000;
		await withTimeout(this.spawned, timeoutMs, `Timed out starting RPC child after ${timeoutMs}ms`);
		if (this.exitResult) throw new Error(this.exitMessage(this.exitResult));
	}

	send<TResponse extends RpcResponse = RpcResponse>(
		command: { type: string } & Record<string, unknown>,
		options?: { timeoutMs?: number },
	): Promise<TResponse> {
		if (this.exitResult) return Promise.reject(new Error(this.exitMessage(this.exitResult)));
		const stdin = this.child.stdin;
		if (!stdin || stdin.destroyed || !stdin.writable) {
			return Promise.reject(new Error(`Cannot send ${command.type}: RPC stdin is not writable`));
		}

		const id = `req-${++this.nextRequestId}`;
		const timeoutMs = options?.timeoutMs ?? this.options.defaultResponseTimeoutMs ?? 30_000;
		return new Promise<TResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${command.type} response`));
			}, timeoutMs);
			this.pending.set(id, {
				command: command.type,
				timer,
				resolve: (response) => resolve(response as TResponse),
				reject,
			});
			stdin.write(serializeJsonLine({ ...command, id }), (error) => {
				if (!error) return;
				const pending = this.pending.get(id);
				if (!pending) return;
				clearTimeout(pending.timer);
				this.pending.delete(id);
				pending.reject(error);
			});
		});
	}

	untilEvent(
		type: string,
		options?: { timeoutMs?: number; predicate?: (event: RpcEvent) => boolean },
	): Promise<RpcEvent> {
		if (this.exitResult) return Promise.reject(new Error(this.exitMessage(this.exitResult)));
		const timeoutMs = options?.timeoutMs ?? 30_000;
		return new Promise((resolve, reject) => {
			const waiter: EventWaiter = {
				type,
				predicate: options?.predicate,
				timer: setTimeout(() => {
					this.eventWaiters.delete(waiter);
					reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${type}`));
				}, timeoutMs),
				resolve,
				reject,
			};
			this.eventWaiters.add(waiter);
		});
	}

	async stop(options?: { timeoutMs?: number }): Promise<{
		exitCode: number | null;
		signal: NodeJS.Signals | null;
		durationMs: number;
		stderr: string;
	}> {
		const startedAt = Date.now();
		const timeoutMs = options?.timeoutMs ?? 5_000;
		if (!this.exitResult) this.child.stdin?.end();

		let exit = this.exitResult ?? (await raceExit(this.exited, Math.min(500, timeoutMs)));
		if (!exit) {
			this.child.kill("SIGTERM");
			exit = await raceExit(this.exited, Math.max(1, timeoutMs - 500));
		}
		if (!exit) {
			this.child.kill("SIGKILL");
			exit = await withTimeout(this.exited, 1_000, "RPC child did not exit after SIGKILL");
		}

		return {
			exitCode: exit.code,
			signal: exit.signal,
			durationMs: Date.now() - startedAt,
			stderr: this.stderrText(),
		};
	}

	stderrText(): string {
		return Buffer.concat(this.stderrChunks).toString("utf8");
	}

	private handleLine(line: string): void {
		if (!line) return;
		let record: Record<string, unknown>;
		try {
			const parsed = JSON.parse(line);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("record is not an object");
			record = parsed as Record<string, unknown>;
		} catch (error) {
			this.options.onParseError?.(line, asError(error));
			return;
		}

		if (record.type === "response") {
			const response: RpcResponse = {
				type: "response",
				id: typeof record.id === "string" ? record.id : undefined,
				command: typeof record.command === "string" ? record.command : "<missing>",
				success: record.success === true,
				error: typeof record.error === "string" ? record.error : undefined,
				data: record.data,
				raw: record,
			};
			const pending = response.id ? this.pending.get(response.id) : undefined;
			if (!pending) {
				this.options.onUnmappedResponse?.(response);
				return;
			}
			this.pending.delete(response.id!);
			clearTimeout(pending.timer);
			if (response.success) pending.resolve(response);
			else pending.reject(new Error(`Pi rejected ${pending.command}: ${response.error ?? "unknown error"}`));
			return;
		}

		if (typeof record.type !== "string") {
			this.options.onParseError?.(line, new Error("record has no string type"));
			return;
		}
		const event = { type: record.type, raw: record };
		this.options.onEvent?.(event);
		for (const waiter of this.eventWaiters) {
			if (waiter.type !== event.type || (waiter.predicate && !waiter.predicate(event))) continue;
			clearTimeout(waiter.timer);
			this.eventWaiters.delete(waiter);
			waiter.resolve(event);
		}
	}

	private rejectOutstanding(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		for (const waiter of this.eventWaiters) {
			clearTimeout(waiter.timer);
			waiter.reject(error);
		}
		this.eventWaiters.clear();
	}

	private exitMessage(exit: ExitResult): string {
		return `RPC child exited (code=${exit.code} signal=${exit.signal}). stderr=${this.stderrText()}`;
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

async function raceExit(exited: Promise<ExitResult>, timeoutMs: number): Promise<ExitResult | undefined> {
	return Promise.race([exited, new Promise<undefined>((resolve) => setTimeout(resolve, timeoutMs))]);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

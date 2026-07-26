import type { RpcCommand, RpcEvent, RpcResponse } from "./protocol.ts";
import { isRpcResponse } from "./protocol.ts";

interface PendingRequest {
	readonly command: string;
	readonly timer: NodeJS.Timeout;
	resolve(response: RpcResponse): void;
	reject(error: Error): void;
}

export interface RequestDispatcherOptions {
	readonly write: (command: RpcCommand & { id?: string }) => void;
	readonly onEvent: (event: RpcEvent) => void;
	readonly responseTimeoutMs?: number;
}

export class RequestDispatcher {
	private readonly options: RequestDispatcherOptions;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly seenResponses = new Set<string>();
	private nextId = 0;

	constructor(options: RequestDispatcherOptions) {
		this.options = options;
	}

	send(command: RpcCommand, timeoutMs = this.options.responseTimeoutMs ?? 30_000): Promise<RpcResponse> {
		const id = `slam-${++this.nextId}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for ${command.type} response`));
			}, timeoutMs);
			this.pending.set(id, { command: command.type, timer, resolve, reject });
			try {
				this.options.write({ ...command, id });
			} catch (error) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	write(command: RpcCommand): void {
		this.options.write(command);
	}

	dispatch(record: unknown): void {
		if (!isRpcResponse(record)) {
			if (!record || typeof record !== "object" || typeof (record as { type?: unknown }).type !== "string") {
				throw new Error("Pi RPC event is missing a string type");
			}
			this.options.onEvent(record as RpcEvent);
			return;
		}

		if (!record.id) throw new Error(`Uncorrelated Pi RPC response for ${record.command}`);
		if (this.seenResponses.has(record.id)) throw new Error(`Duplicate Pi RPC response id: ${record.id}`);
		const pending = this.pending.get(record.id);
		if (!pending) throw new Error(`Unknown Pi RPC response id: ${record.id}`);

		this.seenResponses.add(record.id);
		this.pending.delete(record.id);
		clearTimeout(pending.timer);
		if (record.success) pending.resolve(record);
		else pending.reject(new Error(`Pi rejected ${pending.command}: ${record.error ?? "unknown error"}`));
	}

	fail(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

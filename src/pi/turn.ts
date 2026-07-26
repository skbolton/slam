import type { RpcEvent, RpcResponse } from "./protocol.ts";
import type { PiProcess } from "./process.ts";

export interface TurnResult {
	readonly promptResponse: RpcResponse;
	readonly state: unknown;
	readonly events: readonly RpcEvent[];
	readonly interrupted: boolean;
	readonly exit: { code: number | null; signal: NodeJS.Signals | null };
}

export async function runTurn(
	process: PiProcess,
	message: string,
	options?: { signal?: AbortSignal; settleTimeoutMs?: number; onEvent?: (event: RpcEvent) => void },
): Promise<TurnResult> {
	const events: RpcEvent[] = [];
	let resolveSettled: (() => void) | undefined;
	const settled = new Promise<void>((resolve) => {
		resolveSettled = resolve;
	});
	const unsubscribe = process.onEvent((event) => {
		events.push(event);
		options?.onEvent?.(event);
		if (event.type === "agent_settled") resolveSettled?.();
	});
	let interrupted = false;
	let abortPromise: Promise<unknown> | undefined;
	const abort = () => {
		if (interrupted) return;
		interrupted = true;
		abortPromise = process.dispatcher.send({ type: "abort" });
	};
	options?.signal?.addEventListener("abort", abort, { once: true });

	try {
		await process.start();
		if (options?.signal?.aborted) abort();
		const promptResponse = await process.dispatcher.send({ type: "prompt", message });
		await withTimeout(settled, options?.settleTimeoutMs ?? 120_000, "Timed out waiting for agent_settled");
		await abortPromise;
		const stateResponse = await process.dispatcher.send({ type: "get_state" });
		const exit = await process.stop();
		return { promptResponse, state: stateResponse.data, events, interrupted, exit };
	} catch (error) {
		await process.stop().catch(() => undefined);
		throw error;
	} finally {
		options?.signal?.removeEventListener("abort", abort);
		unsubscribe();
	}
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

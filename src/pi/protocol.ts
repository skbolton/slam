export interface RpcCommand {
	readonly type: string;
	readonly [key: string]: unknown;
}

export interface RpcResponse {
	readonly type: "response";
	readonly id?: string;
	readonly command: string;
	readonly success: boolean;
	readonly data?: unknown;
	readonly error?: string;
}

export interface RpcEvent {
	readonly type: string;
	readonly [key: string]: unknown;
}

export function isRpcResponse(value: unknown): value is RpcResponse {
	return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "response");
}

import { StringDecoder } from "node:string_decoder";

export interface JsonlDecoder {
	push(chunk: string | Uint8Array): void;
	end(): void;
}

export function createJsonlDecoder(onRecord: (record: unknown) => void): JsonlDecoder {
	const decoder = new StringDecoder("utf8");
	let buffer = "";

	function consume(line: string): void {
		const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
		if (!normalized) return;
		try {
			onRecord(JSON.parse(normalized));
		} catch (error) {
			throw new Error(`Invalid Pi RPC JSON record: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	function drain(): void {
		while (true) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			consume(buffer.slice(0, newline));
			buffer = buffer.slice(newline + 1);
		}
	}

	return {
		push(chunk) {
			buffer += typeof chunk === "string" ? chunk : decoder.write(Buffer.from(chunk));
			drain();
		},
		end() {
			buffer += decoder.end();
			drain();
			if (buffer) consume(buffer);
			buffer = "";
		},
	};
}

export function encodeJsonlRecord(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

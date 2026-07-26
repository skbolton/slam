/**
 * Strict JSONL framing primitives shared by the spike's fake-Pi server and by
 * any transport-side helpers the spike uses directly.
 *
 * Deliberate design choices that match `packages/coding-agent/src/modes/rpc/jsonl.ts`:
 * - LF is the only record delimiter. A single trailing CR may be stripped.
 * - Multi-byte UTF-8 sequences split across reads are reassembled by
 *   `StringDecoder("utf8")`. We do NOT call `readline` because readline splits
 *   on U+2028 and U+2029, which can appear inside JSON strings.
 * - Empty lines are tolerated as zero-length records (callers decide).
 * - Lines without a terminator at end-of-stream are emitted as a final record.
 */

import { StringDecoder } from "node:string_decoder";

export interface JsonlLineReader {
	/**
	 * Feed a chunk (string or Buffer) into the reader. Complete LF-delimited
	 * records are passed to `onLine` with any trailing CR stripped.
	 */
	push(chunk: string | Buffer): void;
	/** Flush any remaining buffered content as a final record. */
	end(): void;
}

export function createJsonlLineReader(onLine: (line: string) => void): JsonlLineReader {
	const decoder = new StringDecoder("utf8");
	let buffer = "";

	const emitLine = (line: string) => {
		onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
	};

	return {
		push(chunk) {
			buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

			while (true) {
				const newlineIndex = buffer.indexOf("\n");
				if (newlineIndex === -1) return;
				emitLine(buffer.slice(0, newlineIndex));
				buffer = buffer.slice(newlineIndex + 1);
			}
		},
		end() {
			buffer += decoder.end();
			if (buffer.length > 0) {
				emitLine(buffer);
				buffer = "";
			}
		},
	};
}

/**
 * Serialize a single protocol record with a strict trailing LF. Use exactly one
 * record per call; do not concatenate manually.
 */
export function serializeJsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

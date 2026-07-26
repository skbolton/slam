import { describe, expect, it } from "vitest";
import { createJsonlDecoder, encodeJsonlRecord } from "../../src/pi/jsonl.ts";

describe("Pi RPC JSONL", () => {
	it("uses a trailing LF when encoding", () => {
		expect(encodeJsonlRecord({ type: "get_state" })).toBe('{"type":"get_state"}\n');
	});

	it("reassembles fragmented UTF-8 and preserves Unicode separators", () => {
		const records: unknown[] = [];
		const decoder = createJsonlDecoder((record) => records.push(record));
		const bytes = Buffer.from(encodeJsonlRecord({ text: "hello ✨\u2028middle\u2029end" }));
		for (const byte of bytes) decoder.push(Buffer.from([byte]));
		decoder.end();
		expect(records).toEqual([{ text: "hello ✨\u2028middle\u2029end" }]);
	});

	it("strips one CR before an LF without treating a bare CR as a delimiter", () => {
		const records: unknown[] = [];
		const decoder = createJsonlDecoder((record) => records.push(record));
		decoder.push('{"first":true}\r\n{"text":"carriage\\rreturn"}\n');
		decoder.end();
		expect(records).toEqual([{ first: true }, { text: "carriage\rreturn" }]);
	});

	it("flushes a complete unterminated final record", () => {
		const records: unknown[] = [];
		const decoder = createJsonlDecoder((record) => records.push(record));
		decoder.push('{"type":"agent_settled"}');
		decoder.end();
		expect(records).toEqual([{ type: "agent_settled" }]);
	});

	it("rejects malformed records with protocol context", () => {
		const decoder = createJsonlDecoder(() => undefined);
		expect(() => decoder.push("not-json\n")).toThrow("Invalid Pi RPC JSON record");
	});
});

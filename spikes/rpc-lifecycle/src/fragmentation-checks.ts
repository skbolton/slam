/**
 * Focused checks for strict LF-framed JSONL behavior the spike relies on,
 * mirroring the contract documented in pi/packages/coding-agent/docs/rpc.md.
 *
 * Each case feeds the reader with deliberately fragmented buffers so we
 * exercise byte boundaries rather than ideal-line-sized chunks. The cases
 * cover:
 *
 *   - plain record split mid-UTF-8 codepoint,
 *   - record split mid-JSON-string with embedded U+2028 / U+2029 line
 *     separators (must NOT trigger record splitting),
 *   - CRLF input (trailing CR must be stripped, must not split records),
 *   - back-to-back records in a single chunk (must produce two lines),
 *   - trailing partial record flushed at end-of-stream,
 *   - an explicit empty record is emitted as an empty line (caller decides),
 *   - LFs split across chunks,
	 *   - LFs split across chunks.
 */

import { createJsonlLineReader } from "./jsonl.ts";

const cases: Array<{ name: string; run: () => Promise<void> | void }> = [];

function makeRecorder(): { lines: string[]; reader: { push(c: string | Buffer): void; end(): void } } {
	const lines: string[] = [];
	const reader = createJsonlLineReader((line) => lines.push(line));
	return { lines, reader };
}

function utf8Encode(s: string): Buffer {
	return Buffer.from(s, "utf8");
}

function splitBuffer(buffer: Buffer, sizes: readonly number[]): Buffer[] {
	const slices: Buffer[] = [];
	let cursor = 0;
	for (const size of sizes) {
		if (cursor >= buffer.length) break;
		const slice = buffer.subarray(cursor, Math.min(cursor + size, buffer.length));
		slices.push(Buffer.from(slice));
		cursor += slice.length;
	}
	if (cursor < buffer.length) slices.push(Buffer.from(buffer.subarray(cursor)));
	return slices;
}

function check(condition: unknown, message: string): void {
	if (!condition) throw new Error(`fragmentation-checks: ${message}`);
}

function deepEqual(actual: unknown, expected: unknown, path = "$"): void {
	if (Array.isArray(expected)) {
		check(Array.isArray(actual), `${path}: expected array, got ${typeof actual}`);
		check(
			(actual as unknown[]).length === expected.length,
			`${path}: expected ${expected.length} entries, got ${(actual as unknown[]).length}`,
		);
		for (let i = 0; i < expected.length; i++) {
			deepEqual((actual as unknown[])[i], expected[i], `${path}[${i}]`);
		}
		return;
	}
	if (expected && typeof expected === "object") {
		check(actual && typeof actual === "object", `${path}: expected object, got ${typeof actual}`);
		for (const [k, v] of Object.entries(expected)) {
			deepEqual((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
		}
		return;
	}
	check(actual === expected, `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

cases.push({
	name: "LF delimiter only: CRLF input strips one trailing CR",
	run() {
		const { lines, reader } = makeRecorder();
		reader.push(Buffer.from('{"type":"a"}\r'));
		reader.push(Buffer.from('\n{"type":"b"}\r\n'));
		reader.end();
		deepEqual(lines, ['{"type":"a"}', '{"type":"b"}']);
	},
});

cases.push({
	name: "LF delimiter only: a lone LF yields a record (even an empty one)",
	run() {
		const { lines, reader } = makeRecorder();
		reader.push(Buffer.from('{"type":"x"}\n'));
		reader.end();
		deepEqual(lines, ['{"type":"x"}']);
	},
});

cases.push({
	name: "Record split mid-UTF-8 codepoint is reassembled",
	run() {
		const emoji = "𓀀"; // a 4-byte UTF-8 codepoint; "character" already > U+FFFF
		const payload = `${JSON.stringify({ type: "message_update", text: `hi ${emoji} there` })}\n`;
		const bytes = utf8Encode(payload);
		const chunkSizes = [1, 3, 5, 7, 11, 13];
		const slices = splitBuffer(bytes, chunkSizes);
		const { lines, reader } = makeRecorder();
		for (const slice of slices) reader.push(slice);
		reader.end();
		check(lines.length === 1, `expected exactly one record, got ${lines.length}`);
		const parsed = JSON.parse(lines[0]!);
		check(parsed.text === `hi ${emoji} there`, `text mismatch with split codepoint: ${parsed.text}`);
	},
});

cases.push({
	name: "Unicode line separators U+2028 / U+2029 inside JSON strings do NOT split records",
	run() {
		const payload = `${JSON.stringify({ type: "text", text: "sep\u2028sep\u2029sep" })}\n`;
		const bytes = utf8Encode(payload);
		const slices = splitBuffer(bytes, [8, 8, 8, 8, 8, 8, 8, 8, 8]);
		const { lines, reader } = makeRecorder();
		for (const slice of slices) reader.push(slice);
		reader.end();
		check(lines.length === 1, `expected exactly one record, got ${lines.length}`);
		const parsed = JSON.parse(lines[0]!);
		check(parsed.text.includes("\u2028"), "U+2028 should survive in the string");
		check(parsed.text.includes("\u2029"), "U+2029 should survive in the string");
	},
});

cases.push({
	name: "Back-to-back records in a single chunk produce two records",
	run() {
		const payload = '{"type":"a"}\n{"type":"b"}\n';
		const { lines, reader } = makeRecorder();
		reader.push(Buffer.from(payload));
		reader.end();
		deepEqual(lines, ['{"type":"a"}', '{"type":"b"}']);
	},
});

cases.push({
	name: "End-of-stream flushes a trailing partial record verbatim (caller decides if it is valid JSON)",
	run() {
		const { lines, reader } = makeRecorder();
		reader.push(Buffer.from('{"type":"x"}\n{"type":"y'));
		reader.end();
		check(lines.length === 2, `expected two records, got ${lines.length}`);
		check(lines[0] === '{"type":"x"}', `expected first record to be {"type":"x"}, got ${lines[0]}`);
		check(
			lines[1] === '{"type":"y',
			`expected trailing partial record to be flushed verbatim, got ${JSON.stringify(lines[1])}`,
		);
	},
});

cases.push({
	name: "Empty lines are emitted as empty strings (caller-policy)",
	run() {
		const { lines, reader } = makeRecorder();
		reader.push(Buffer.from('{"type":"x"}\n\n{"type":"y"}\n'));
		reader.end();
		deepEqual(lines, ['{"type":"x"}', "", '{"type":"y"}']);
	},
});

cases.push({
	name: "Single byte per chunk (extreme fragmentation) round-trips a JSON payload with non-ASCII",
	run() {
		const emoji = "✨🌟✨";
		const payload = `${JSON.stringify({ text: emoji, payload: "x".repeat(50) })}\n`;
		const bytes = utf8Encode(payload);
		const { lines, reader } = makeRecorder();
		for (const byte of bytes) reader.push(Buffer.from([byte]));
		reader.end();
		check(lines.length === 1, `expected one record, got ${lines.length}`);
		const parsed = JSON.parse(lines[0]!);
		check(parsed.text === emoji, `emoji mismatch: ${parsed.text}`);
	},
});

cases.push({
	name: "Lone CR characters between JSON tokens stay in-buffer until the next LF",
	run() {
		// The protocol is LF-only. We tolerate CRLF by stripping a single trailing
		// CR only when it sits immediately before the LF. A bare CR mid-record has
		// no special meaning and stays as an embedded code point.
		const { lines, reader } = makeRecorder();
		reader.push(Buffer.from('{"type":"a"}-\r{"type":"b"}\n'));
		reader.end();
		check(lines.length === 1, `expected single record, got ${lines.length}`);
		check(lines[0]!.includes("\r"), `record should retain the embedded CR character`);
		check(
			lines[0] === '{"type":"a"}-\r{"type":"b"}',
			`expected exact retention, got ${JSON.stringify(lines[0])}`,
		);
	},
});

cases.push({
	name: "Lone CR characters within a JSON string survive",
	run() {
		const payload = `${JSON.stringify({ type: "x", text: "carriage\rreturn" })}\n`;
		const { lines, reader } = makeRecorder();
		reader.push(Buffer.from(payload));
		reader.end();
		check(lines.length === 1, `expected one record`);
		const parsed = JSON.parse(lines[0]!);
		check(parsed.text === "carriage\rreturn", `unexpected text: ${parsed.text}`);
	},
});

cases.push({
	name: "A LF-only chunk with size 1 is sufficient to flush at least one record",
	run() {
		const { lines, reader } = makeRecorder();
		const payload = Buffer.from('{"type":"x"}\n{"type":"y"}\n');
		for (const byte of payload.subarray(0, payload.length - 1)) reader.push(Buffer.from([byte]));
		check(lines.length > 0, `expected at least one record from sequential single-byte writes`);
	},
});

async function main(): Promise<void> {
	let failed = 0;
	for (const test of cases) {
		try {
			await test.run();
			console.log(`fragmentation-checks: OK ${test.name}`);
		} catch (error) {
			failed++;
			console.error(`fragmentation-checks: FAIL ${test.name}`);
			console.error(error instanceof Error ? error.stack ?? error.message : String(error));
		}
	}
	if (failed > 0) {
		console.error(`fragmentation-checks: ${failed} of ${cases.length} failed`);
		process.exit(1);
	}
	console.log(`fragmentation-checks: ${cases.length} of ${cases.length} OK`);
}

main();

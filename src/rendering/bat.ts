import { spawn } from "node:child_process";
import { once } from "node:events";

interface MarkdownLine {
	readonly content: string;
	readonly ending: string;
	readonly tableAllowed: boolean;
}

interface TableRow {
	readonly cells: readonly string[];
	readonly line: MarkdownLine;
}

interface BufferedTable {
	readonly header: TableRow;
	readonly delimiter: TableRow;
	readonly body: TableRow[];
}

type ColumnAlignment = "default" | "left" | "center" | "right";

export class BatRenderer {
	private readonly executable: string;
	private readonly finishLine: () => void;
	private readonly language: string;
	private child: ReturnType<typeof spawn> | undefined;
	private wroteText = false;
	private endedWithNewline = false;
	private lineBuffer = "";
	private pendingLine: MarkdownLine | undefined;
	private table: BufferedTable | undefined;
	private fence: { marker: string; length: number } | undefined;

	constructor(
		executable: string,
		finishLine: () => void = () => {
			process.stdout.write("\n");
		},
		language = "markdown",
	) {
		this.executable = executable;
		this.finishLine = finishLine;
		this.language = language;
	}

	async write(text: string): Promise<void> {
		if (text.length === 0) return;
		this.wroteText = true;
		this.endedWithNewline = text.endsWith("\n");
		await this.start();
		if (this.language !== "markdown") {
			await this.writeToBat(text);
			return;
		}
		this.lineBuffer += text;
		let newline = this.lineBuffer.indexOf("\n");
		while (newline >= 0) {
			const rawLine = this.lineBuffer.slice(0, newline);
			this.lineBuffer = this.lineBuffer.slice(newline + 1);
			const carriageReturn = rawLine.endsWith("\r");
			await this.processLine(rawLine.slice(0, carriageReturn ? -1 : undefined), carriageReturn ? "\r\n" : "\n");
			newline = this.lineBuffer.indexOf("\n");
		}
	}

	async end(): Promise<void> {
		if (this.language === "markdown" && this.lineBuffer.length > 0) {
			await this.processLine(this.lineBuffer, "");
			this.lineBuffer = "";
		}
		await this.flushTable();
		if (this.pendingLine) {
			await this.writeToBat(this.pendingLine.content + this.pendingLine.ending);
			this.pendingLine = undefined;
		}

		const child = this.child;
		this.child = undefined;
		if (!child) return;
		child.stdin?.end();
		const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
		if (code !== 0) throw new Error(`Bat exited unsuccessfully (code=${code} signal=${signal})`);
		if (this.wroteText && !this.endedWithNewline) this.finishLine();
	}

	private async start(): Promise<void> {
		if (!this.child) {
			this.child = spawn(
				this.executable,
				[`--language=${this.language}`, "--paging=never", "--color=always", "--style=plain"],
				{
					stdio: ["pipe", "inherit", "inherit"],
				},
			);
			await Promise.race([
				once(this.child, "spawn"),
				new Promise<never>((_, reject) => this.child?.once("error", reject)),
			]);
		}
	}

	private async processLine(content: string, ending: string): Promise<void> {
		const line = { content, ending, tableAllowed: !this.fence };
		this.updateFence(content);

		if (this.table) {
			const row = parseTableRow(line);
			if (row && row.cells.length <= this.table.delimiter.cells.length) {
				this.table.body.push(row);
				return;
			}
			await this.flushTable();
		}

		if (!this.pendingLine) {
			if (line.tableAllowed && parseTableRow(line)) this.pendingLine = line;
			else await this.writeToBat(line.content + line.ending);
			return;
		}

		const header = parseTableRow(this.pendingLine);
		const delimiter = parseTableDelimiter(line);
		if (
			this.pendingLine.tableAllowed &&
			line.tableAllowed &&
			header &&
			delimiter &&
			header.cells.length === delimiter.cells.length
		) {
			this.table = { header, delimiter, body: [] };
			this.pendingLine = undefined;
			return;
		}

		await this.writeToBat(this.pendingLine.content + this.pendingLine.ending);
		this.pendingLine = undefined;
		if (line.tableAllowed && parseTableRow(line)) this.pendingLine = line;
		else await this.writeToBat(line.content + line.ending);
	}

	private async flushTable(): Promise<void> {
		const table = this.table;
		if (!table) return;
		this.table = undefined;
		await this.writeToBat(formatTable(table));
	}

	private updateFence(line: string): void {
		if (this.fence) {
			const closing = line.match(/^ {0,3}(`+|~+)\s*$/);
			if (closing?.[1]?.startsWith(this.fence.marker) && closing[1].length >= this.fence.length) {
				this.fence = undefined;
			}
			return;
		}

		const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
		if (opening?.[1]) this.fence = { marker: opening[1][0] ?? "", length: opening[1].length };
	}

	private async writeToBat(text: string): Promise<void> {
		if (text.length === 0) return;
		const stdin = this.child?.stdin;
		if (!stdin?.writable) throw new Error("Bat input closed during assistant message");
		await new Promise<void>((resolve, reject) => stdin.write(text, (error) => (error ? reject(error) : resolve())));
	}
}

function parseTableRow(line: MarkdownLine): TableRow | undefined {
	const text = line.content.trim();
	if (!hasUnescapedPipe(text)) return undefined;
	const cells = splitTableCells(text);
	return cells.length > 0 ? { cells, line } : undefined;
}

function parseTableDelimiter(line: MarkdownLine): TableRow | undefined {
	const row = parseTableRow(line);
	if (!row?.cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return undefined;
	return row;
}

function hasUnescapedPipe(text: string): boolean {
	for (let index = 0; index < text.length; index++) {
		if (text[index] === "|" && !isEscaped(text, index)) return true;
	}
	return false;
}

function splitTableCells(text: string): string[] {
	let start = 0;
	let end = text.length;
	if (text[start] === "|") start++;
	if (end > start && text[end - 1] === "|" && !isEscaped(text, end - 1)) end--;

	const cells: string[] = [];
	let cellStart = start;
	for (let index = start; index < end; index++) {
		if (text[index] === "|" && !isEscaped(text, index)) {
			cells.push(text.slice(cellStart, index).trim());
			cellStart = index + 1;
		}
	}
	cells.push(text.slice(cellStart, end).trim());
	return cells;
}

function isEscaped(text: string, index: number): boolean {
	let backslashes = 0;
	for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) backslashes++;
	return backslashes % 2 === 1;
}

function formatTable(table: BufferedTable): string {
	const columnCount = table.delimiter.cells.length;
	const alignments = table.delimiter.cells.map(delimiterAlignment);
	const rows = [table.header, ...table.body];
	const widths = Array.from({ length: columnCount }, (_, column) => {
		const contentWidth = Math.max(...rows.map((row) => displayWidth(row.cells[column] ?? "")));
		const delimiterWidth = alignments[column] === "center" ? 5 : alignments[column] === "default" ? 3 : 4;
		return Math.max(contentWidth, delimiterWidth);
	});
	const indent = table.header.line.content.match(/^\s*/)?.[0] ?? "";
	const formattedRows = rows.map((row) => formatContentRow(row.cells, widths, alignments, indent));
	const delimiter = `${indent}| ${widths
		.map((width, column) => formatDelimiter(width, alignments[column] ?? "left"))
		.join(" | ")} |`;
	const lines = [formattedRows[0] ?? "", delimiter, ...formattedRows.slice(1)];
	const endings = [table.header.line.ending, table.delimiter.line.ending, ...table.body.map((row) => row.line.ending)];
	return lines.map((line, index) => line + (endings[index] ?? "")).join("");
}

function delimiterAlignment(cell: string): ColumnAlignment {
	if (cell.startsWith(":") && cell.endsWith(":")) return "center";
	if (cell.endsWith(":")) return "right";
	if (cell.startsWith(":")) return "left";
	return "default";
}

function formatContentRow(
	cells: readonly string[],
	widths: readonly number[],
	alignments: readonly ColumnAlignment[],
	indent: string,
): string {
	return `${indent}| ${widths
		.map((width, column) => padCell(cells[column] ?? "", width, alignments[column] ?? "left"))
		.join(" | ")} |`;
}

function padCell(cell: string, width: number, alignment: ColumnAlignment): string {
	const padding = Math.max(0, width - displayWidth(cell));
	if (alignment === "right") return `${" ".repeat(padding)}${cell}`;
	if (alignment === "center") {
		const left = Math.floor(padding / 2);
		return `${" ".repeat(left)}${cell}${" ".repeat(padding - left)}`;
	}
	return `${cell}${" ".repeat(padding)}`;
}

function formatDelimiter(width: number, alignment: ColumnAlignment): string {
	if (alignment === "center") return `:${"-".repeat(width - 2)}:`;
	if (alignment === "right") return `${"-".repeat(width - 1)}:`;
	if (alignment === "left") return `:${"-".repeat(width - 1)}`;
	return "-".repeat(width);
}

function displayWidth(text: string): number {
	return Array.from(text).length;
}

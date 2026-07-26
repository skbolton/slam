import { spawn } from "node:child_process";
import { once } from "node:events";

export class BatRenderer {
	private readonly executable: string;
	private readonly finishLine: () => void;
	private child: ReturnType<typeof spawn> | undefined;
	private wroteText = false;
	private endedWithNewline = false;

	constructor(
		executable: string,
		finishLine: () => void = () => {
			process.stdout.write("\n");
		},
	) {
		this.executable = executable;
		this.finishLine = finishLine;
	}

	async write(text: string): Promise<void> {
		this.wroteText = true;
		this.endedWithNewline = text.endsWith("\n");
		if (!this.child) {
			this.child = spawn(
				this.executable,
				["--language=markdown", "--paging=never", "--color=always", "--style=plain"],
				{
					stdio: ["pipe", "inherit", "inherit"],
				},
			);
			await Promise.race([
				once(this.child, "spawn"),
				new Promise<never>((_, reject) => this.child?.once("error", reject)),
			]);
		}
		const stdin = this.child.stdin;
		if (!stdin?.writable) throw new Error("Bat input closed during assistant message");
		await new Promise<void>((resolve, reject) => stdin.write(text, (error) => (error ? reject(error) : resolve())));
	}

	async end(): Promise<void> {
		const child = this.child;
		this.child = undefined;
		if (!child) return;
		child.stdin?.end();
		const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
		if (code !== 0) throw new Error(`Bat exited unsuccessfully (code=${code} signal=${signal})`);
		if (this.wroteText && !this.endedWithNewline) this.finishLine();
	}
}

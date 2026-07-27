import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BatRenderer } from "../../src/rendering/bat.ts";

describe("Bat renderer", () => {
	it("streams one assistant message with required flags", async () => {
		const directory = mkdtempSync(join(tmpdir(), "slam-bat-test-"));
		try {
			const log = join(directory, "log");
			const fake = join(directory, "bat");
			writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(log)}\ncat >> ${JSON.stringify(log)}\n`, {
				mode: 0o700,
			});
			let boundaries = 0;
			const renderer = new BatRenderer(fake, () => {
				boundaries++;
			});
			await renderer.write("first");
			await renderer.write(" second");
			await renderer.end();
			const output = readFileSync(log, "utf8");
			expect(output).toContain("--language=markdown --paging=never --color=always --style=plain");
			expect(output).toContain("first second");
			expect(boundaries).toBe(1);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("does not add a second line ending when output already has one", async () => {
		const directory = mkdtempSync(join(tmpdir(), "slam-bat-test-"));
		try {
			const fake = join(directory, "bat");
			writeFileSync(fake, "#!/bin/sh\ncat >/dev/null\n", { mode: 0o700 });
			let boundaries = 0;
			const renderer = new BatRenderer(fake, () => {
				boundaries++;
			});
			await renderer.write("complete\n");
			await renderer.end();
			expect(boundaries).toBe(0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("uses non-Markdown syntax without Markdown table buffering", async () => {
		const directory = mkdtempSync(join(tmpdir(), "slam-bat-test-"));
		try {
			const log = join(directory, "log");
			const fake = join(directory, "bat");
			writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(log)}\ncat >> ${JSON.stringify(log)}\n`, {
				mode: 0o700,
			});
			const renderer = new BatRenderer(fake, undefined, "js");
			await renderer.write("| a | long |\n| --- | --- |\n| x | y |\n");
			await renderer.end();

			expect(readFileSync(log, "utf8")).toBe(
				"--language=js --paging=never --color=always --style=plain\n| a | long |\n| --- | --- |\n| x | y |\n",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("buffers and aligns Markdown tables split across stream chunks", async () => {
		const directory = mkdtempSync(join(tmpdir(), "slam-bat-test-"));
		try {
			const rendered = join(directory, "rendered");
			const fake = join(directory, "bat");
			writeFileSync(fake, `#!/bin/sh\ncat > ${JSON.stringify(rendered)}\n`, { mode: 0o700 });
			const renderer = new BatRenderer(fake);
			await renderer.write("Before\n| Name | Quan");
			await renderer.write("tity |\n| :--- | ---: |\n| apples | 2 |\n");
			await renderer.write("| fig | 100 |\n\nAfter\n");
			await renderer.end();

			expect(readFileSync(rendered, "utf8")).toBe(
				"Before\n| Name   | Quantity |\n| :----- | -------: |\n| apples |        2 |\n| fig    |      100 |\n\nAfter\n",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("preserves escaped pipes and delimiter alignment markers", async () => {
		const directory = mkdtempSync(join(tmpdir(), "slam-bat-test-"));
		try {
			const rendered = join(directory, "rendered");
			const fake = join(directory, "bat");
			writeFileSync(fake, `#!/bin/sh\ncat > ${JSON.stringify(rendered)}\n`, { mode: 0o700 });
			const renderer = new BatRenderer(fake);
			await renderer.write("A | B | C\n:--- | :---: | ---:\nx\\|y | middle | z\n");
			await renderer.end();

			expect(readFileSync(rendered, "utf8")).toBe(
				"| A    |   B    |    C |\n| :--- | :----: | ---: |\n| x\\|y | middle |    z |\n",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("does not format table-like text inside fenced code blocks", async () => {
		const directory = mkdtempSync(join(tmpdir(), "slam-bat-test-"));
		try {
			const rendered = join(directory, "rendered");
			const fake = join(directory, "bat");
			writeFileSync(fake, `#!/bin/sh\ncat > ${JSON.stringify(rendered)}\n`, { mode: 0o700 });
			const markdown = "```markdown\n| a | long |\n| --- | --- |\n| x | y |\n```\n";
			const renderer = new BatRenderer(fake);
			await renderer.write(markdown);
			await renderer.end();

			expect(readFileSync(rendered, "utf8")).toBe(markdown);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("reports Bat startup failure", async () => {
		const renderer = new BatRenderer("/missing/bat");
		await expect(renderer.write("text")).rejects.toThrow("ENOENT");
	});
});

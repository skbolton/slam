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

	it("reports Bat startup failure", async () => {
		const renderer = new BatRenderer("/missing/bat");
		await expect(renderer.write("text")).rejects.toThrow("ENOENT");
	});
});

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sessionProcessOptions, verifiedAttachment } from "../../src/session/coordinator.ts";

describe("session coordinator", () => {
	it("creates lazily without a session selector when unattached", () => {
		const options = sessionProcessOptions({ executable: "pi", shellCwd: "/project", attachment: {} });
		expect(options.args).toEqual([]);
		expect(options.cwd).toBe("/project");
	});

	it("applies a pending model on first use without inventing a session", () => {
		const options = sessionProcessOptions({
			executable: "pi",
			shellCwd: "/project",
			attachment: { provider: "zionlab", model: "Delta" },
		});
		expect(options.args).toEqual(["--provider", "zionlab", "--model", "Delta"]);
	});

	it("resumes an attachment by canonical full path", () => {
		const options = sessionProcessOptions({
			executable: "pi",
			shellCwd: "/other",
			attachment: { sessionFile: "./session.jsonl", provider: "zionlab", model: "Delta" },
		});
		expect(options.args).toEqual([
			"--session",
			resolve("./session.jsonl"),
			"--provider",
			"zionlab",
			"--model",
			"Delta",
		]);
	});

	it("retains an attachment across shell directory changes", () => {
		const file = resolve("session.jsonl");
		const options = sessionProcessOptions({
			executable: "pi",
			shellCwd: "/new-directory",
			attachment: { sessionFile: file },
		});
		expect(options.cwd).toBe("/new-directory");
		expect(options.args).toEqual(["--session", file]);
	});

	it("accepts authoritative state only when identity matches", () => {
		const file = resolve("session.jsonl");
		expect(
			verifiedAttachment(
				{},
				{ sessionFile: file, sessionId: "one" },
				{ sessionFile: file, sessionId: "one", model: { provider: "p", id: "m" } },
			),
		).toEqual({ sessionFile: file, sessionId: "one", provider: "p", model: "m" });
	});

	it("preserves previous attachment when verification fails", () => {
		const previous = { sessionFile: "/old", sessionId: "old" };
		expect(() =>
			verifiedAttachment(previous, { sessionFile: "/wanted" }, { sessionFile: "/other", sessionId: "new" }),
		).toThrow("unexpected session");
		expect(previous).toEqual({ sessionFile: "/old", sessionId: "old" });
	});
});

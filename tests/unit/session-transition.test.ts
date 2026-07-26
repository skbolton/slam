import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	beginAttachmentTransition,
	commitAttachmentTransition,
	detachAttachment,
	rollbackAttachmentTransition,
} from "../../src/session/transition.ts";

describe("attachment transitions", () => {
	it("preserves prior state when the target is missing", () => {
		const previous = { sessionFile: "/old", sessionId: "old" };
		expect(() => beginAttachmentTransition(previous, "/missing/session")).toThrow("does not exist");
		expect(previous).toEqual({ sessionFile: "/old", sessionId: "old" });
	});

	it("commits only complete verified state and otherwise rolls back", () => {
		const directory = mkdtempSync(join(tmpdir(), "slam-transition-"));
		try {
			const file = join(directory, "session.jsonl");
			writeFileSync(file, "{}\n");
			const previous = { sessionFile: "/old", sessionId: "old" };
			const transition = beginAttachmentTransition(previous, file);
			expect(() => commitAttachmentTransition(transition, { sessionFile: file })).toThrow("incomplete");
			expect(rollbackAttachmentTransition(transition)).toBe(previous);
			expect(commitAttachmentTransition(transition, { sessionFile: file, sessionId: "new" })).toEqual({
				sessionFile: file,
				sessionId: "new",
			});
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("detaches explicitly without creating replacement state", () => {
		expect(detachAttachment()).toEqual({});
	});

	it("allows independent callers to retain the same verified attachment", () => {
		const shared = { sessionFile: "/session", sessionId: "one" };
		const first = { ...shared };
		const second = { ...shared };
		expect(first).toEqual(second);
		first.sessionId = "branch-a";
		expect(second.sessionId).toBe("one");
	});
});

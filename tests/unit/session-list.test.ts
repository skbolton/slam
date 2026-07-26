import { describe, expect, it } from "vitest";
import { resolveProjectSession, type ListedSession } from "../../src/session/list.ts";

const sessions: ListedSession[] = [
	{ id: "abcdef", path: "/one", cwd: "/project", modified: "2026-01-01" },
	{ id: "abcxyz", path: "/two", cwd: "/project", name: "Two", modified: "2026-01-02" },
];

describe("project session resolution", () => {
	it("resolves exact and unique-prefix ids", () => {
		expect(resolveProjectSession(sessions, "abcdef").path).toBe("/one");
		expect(resolveProjectSession(sessions, "abcx").path).toBe("/two");
	});

	it("rejects ambiguous and missing selectors", () => {
		expect(() => resolveProjectSession(sessions, "abc")).toThrow("ambiguous");
		expect(() => resolveProjectSession(sessions, "missing")).toThrow("No session found");
	});
});

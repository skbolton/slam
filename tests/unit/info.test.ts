import { describe, expect, it, vi } from "vitest";
import { infoCommand } from "../../src/commands/info.ts";

describe(":info output", () => {
	it("reports unattached pending model state without starting Pi", () => {
		const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			infoCommand({ SLAM_ACTIVE: "0", SLAM_MODEL_PENDING: "1", SLAM_PROVIDER: "p", SLAM_MODEL: "m" }, "/shell");
			expect(String(write.mock.calls[0]?.[0])).toContain("Session: unattached");
			expect(String(write.mock.calls[0]?.[0])).toContain("Model: p/m (pending)");
			expect(String(write.mock.calls[0]?.[0])).toContain("Thinking display: off");
		} finally {
			write.mockRestore();
		}
	});

	it("reports thinking visibility", () => {
		const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			infoCommand({ SLAM_ACTIVE: "0", SLAM_THINKING_VISIBLE: "1" }, "/shell");
			expect(String(write.mock.calls[0]?.[0])).toContain("Thinking display: on");
		} finally {
			write.mockRestore();
		}
	});

	it("reports attached session and cwd mismatch", () => {
		const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			infoCommand({ SLAM_ACTIVE: "1", SLAM_SESSION_ID: "one", SLAM_SESSION_CWD: "/session" }, "/shell");
			const output = String(write.mock.calls[0]?.[0]);
			expect(output).toContain("Session ID: one");
			expect(output).toContain("Shell cwd: /shell");
			expect(output).toContain("Session cwd: /session");
		} finally {
			write.mockRestore();
		}
	});
});

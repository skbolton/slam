import { describe, expect, it, vi } from "vitest";
import { RequestDispatcher } from "../../src/pi/dispatcher.ts";

describe("request dispatcher", () => {
	it("correlates interleaved responses by id and dispatches events", async () => {
		const writes: Array<Record<string, unknown>> = [];
		const events: Array<Record<string, unknown>> = [];
		const dispatcher = new RequestDispatcher({
			write: (command) => writes.push(command),
			onEvent: (event) => events.push(event),
		});
		const prompt = dispatcher.send({ type: "prompt", message: "hello" });
		const state = dispatcher.send({ type: "get_state" });
		dispatcher.dispatch({ type: "agent_start" });
		dispatcher.dispatch({ type: "response", id: writes[1]?.id, command: "get_state", success: true, data: {} });
		dispatcher.dispatch({ type: "response", id: writes[0]?.id, command: "prompt", success: true });
		expect((await state).command).toBe("get_state");
		expect((await prompt).command).toBe("prompt");
		expect(events).toEqual([{ type: "agent_start" }]);
	});

	it("rejects command errors", async () => {
		const writes: Array<Record<string, unknown>> = [];
		const dispatcher = new RequestDispatcher({ write: (command) => writes.push(command), onEvent: () => undefined });
		const response = dispatcher.send({ type: "set_model" });
		dispatcher.dispatch({
			type: "response",
			id: writes[0]?.id,
			command: "set_model",
			success: false,
			error: "missing",
		});
		await expect(response).rejects.toThrow("Pi rejected set_model: missing");
	});

	it("fails visibly for unknown and duplicate response ids", async () => {
		const writes: Array<Record<string, unknown>> = [];
		const dispatcher = new RequestDispatcher({ write: (command) => writes.push(command), onEvent: () => undefined });
		const response = dispatcher.send({ type: "get_state" });
		const record = { type: "response", id: writes[0]?.id, command: "get_state", success: true };
		dispatcher.dispatch(record);
		await response;
		expect(() => dispatcher.dispatch(record)).toThrow("Duplicate Pi RPC response id");
		expect(() => dispatcher.dispatch({ ...record, id: "other" })).toThrow("Unknown Pi RPC response id");
	});

	it("times out pending requests", async () => {
		vi.useFakeTimers();
		try {
			const dispatcher = new RequestDispatcher({ write: () => undefined, onEvent: () => undefined });
			const response = dispatcher.send({ type: "get_state" }, 100);
			const assertion = expect(response).rejects.toThrow("Timed out waiting for get_state response");
			await vi.advanceTimersByTimeAsync(100);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});
});

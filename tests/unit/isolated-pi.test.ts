import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createIsolatedPiEnvironment } from "../helpers/isolated-pi.ts";

describe("isolated Pi environment", () => {
	it("redirects configuration and sessions away from the user home", () => {
		const environment = createIsolatedPiEnvironment();
		try {
			expect(environment.env.HOME).toBe(environment.root);
			expect(environment.env.PI_CODING_AGENT_DIR).toBe(environment.configDir);
			expect(environment.env.PI_CODING_AGENT_SESSION_DIR).toBe(environment.sessionDir);
			expect(environment.env.PI_OFFLINE).toBe("1");
		} finally {
			environment.cleanup();
		}
		expect(existsSync(environment.root)).toBe(false);
	});
});

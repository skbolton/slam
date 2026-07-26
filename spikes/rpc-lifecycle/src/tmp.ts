import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TmpSession {
	readonly path: string;
	cleanup(): void;
}

/**
 * Create an isolated scratch directory for a spike run.
 *
 * The path is created under `os.tmpdir()` with a constant prefix so we can
 * recognize and clean it up deterministically. The caller passes the returned
 * path as `--session-dir` and other invoke arguments; we never read or write
 * under `~/.pi` for any spike.
 */
export function makeTmpSession(prefix = "slam-spike-"): TmpSession {
	const path = mkdtempSync(join(tmpdir(), prefix));
	return {
		path,
		cleanup() {
			rmSync(path, { recursive: true, force: true });
		},
	};
}

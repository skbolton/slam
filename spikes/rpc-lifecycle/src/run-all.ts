/**
 * Runs every check in this spike in sequence:
 *
 *   1. fragmentation-checks: direct unit checks of the strict LF JSONL reader,
 *   2. deterministic-lifecycle: two fake-Pi processes that prove the lifecycle
 *      architecture end-to-end,
	 *   3. protocol-edge-checks: interleaving, stderr, fragmented records, early exit,
	 *   4. abort-check: signal-driven abort path,
	 *   5. live-pi-smoke: opt-in real Pi binary smoke (skips if no binary found).
 *
 * Each step exits non-zero on failure, which causes this runner to abort. The
 * live Pi smoke never fails the spike: it skips with a clear message if the
 * real binary isn't on disk.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));

interface Step {
	name: string;
	script: string;
	args?: readonly string[];
}

const steps: Step[] = [
	{ name: "fragmentation", script: "fragmentation-checks.ts" },
	{ name: "lifecycle", script: "deterministic-lifecycle.ts" },
	{ name: "protocol-edges", script: "protocol-edge-checks.ts" },
	{ name: "abort", script: "abort-check.ts" },
	{ name: "live-pi", script: "live-pi-smoke.ts" },
];

async function run(step: Step): Promise<{ code: number | null; skipped: boolean }> {
	const cwd = SPIKE_DIR;
	const args = [
		"--experimental-strip-types",
		"--no-warnings",
		join(SPIKE_DIR, step.script),
		...(step.args ?? []),
	];
	return new Promise((resolve) => {
		const child = spawn(process.execPath, args, { cwd, stdio: "inherit" });
		child.on("exit", (code) => {
			resolve({ code, skipped: false });
		});
	});
}

async function main(): Promise<void> {
	for (const step of steps) {
		console.log(`\n--- spike: ${step.name} ---`);
		const result = await run(step);
		if (result.code !== 0) {
			console.error(`spike: ${step.name} failed`);
			process.exit(result.code ?? 1);
		}
	}
	console.log("\nspike: all checks passed");
}

main();

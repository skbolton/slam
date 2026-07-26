import { spawnSync } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const localBiome = join(projectRoot, "node_modules", ".bin", "biome");
const searchPath = (process.env.PATH ?? "")
	.split(delimiter)
	.filter((entry) => entry !== join(projectRoot, "node_modules", ".bin"))
	.join(delimiter);

const candidates = process.env.SLAM_BIOME ? [process.env.SLAM_BIOME] : ["biome", localBiome];
for (const command of candidates) {
	const result = spawnSync(command, process.argv.slice(2), {
		stdio: "inherit",
		env: { ...process.env, PATH: command === "biome" ? searchPath : process.env.PATH },
	});
	if (result.error && "code" in result.error && result.error.code === "ENOENT") continue;
	process.exit(result.status ?? 1);
}

console.error("Biome is unavailable; enter `nix develop` or set SLAM_BIOME");
process.exit(127);

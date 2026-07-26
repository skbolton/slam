import { readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const values = {
	slamVersion: process.env.SLAM_BUILD_VERSION ?? packageJson.version,
	piVersion: process.env.SLAM_PI_VERSION ?? "unknown",
	piPackageRevision: process.env.SLAM_PI_PACKAGE_REVISION ?? "unknown",
};

writeFileSync(
	new URL("../src/build-info.generated.ts", import.meta.url),
	`export const BUILD_INFO = ${JSON.stringify(values, null, "\t")} as const;\n`,
);

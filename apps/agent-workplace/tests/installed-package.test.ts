import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const register = join(root, "components/session-state/src/register.mjs");

test("the built Electron main imports only Electron, Node and packages the manifest declares", () => {
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const declared = new Set([
		"electron",
		...Object.keys(manifest.dependencies),
		...Object.keys(manifest.peerDependencies),
	]);
	const main = readFileSync(join(root, "apps/agent-workplace/dist/electron/main.js"), "utf8");
	const packages = [...main.matchAll(/(?:^import [^;]*?from |\bimport\()"([^".][^"]*)"/gm)]
		.map((match) => match[1]!)
		.filter((specifier) => !specifier.startsWith("node:"))
		.map((specifier) =>
			specifier
				.split("/")
				.slice(0, specifier.startsWith("@") ? 2 : 1)
				.join("/"),
		);
	expect(packages.length).toBeGreaterThan(0);
	expect(packages.filter((name) => !declared.has(name))).toEqual([]);
});

test("a process the package starts resolves Pi's own libraries from the Pi that launched it", () => {
	const installed = mkdtempSync(join(tmpdir(), "installed-package-"));
	try {
		const script = join(installed, "uses-pi.mjs");
		writeFileSync(script, 'import { Type } from "typebox";\nprocess.stdout.write(typeof Type.Object);\n');
		const env = { ...process.env };
		delete env.PI_HOST_PACKAGE_DIR;
		const without = spawnSync(process.execPath, ["--import", register, script], { env, encoding: "utf8" });
		expect(without.status).not.toBe(0);
		expect(without.stderr).toContain("ERR_MODULE_NOT_FOUND");
		const withHost = execFileSync(process.execPath, ["--import", register, script], {
			env: { ...env, PI_HOST_PACKAGE_DIR: root },
			encoding: "utf8",
		});
		expect(withHost).toBe("function");
	} finally {
		rmSync(installed, { recursive: true, force: true });
	}
});

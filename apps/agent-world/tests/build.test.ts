import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { expect, it } from "vitest";

const app = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

/** Every file under `dir`, by relative path, with its contents. */
function tree(dir: string): Record<string, string> {
	const files: Record<string, string> = {};
	for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true }))
		if (entry.isFile()) {
			const path = join(entry.parentPath, entry.name);
			files[path.slice(dir.length + 1)] = readFileSync(path, "utf8");
		}
	return files;
}

// Git installs omit dev dependencies, so the package ships the built app. It must match its source.
it("the committed dist/ matches a fresh build of the world UI, main process, and preload (run npm run build:world)", {
	timeout: 120_000,
}, async () => {
	const outDir = mkdtempSync(join(tmpdir(), "agent-world-build-"));
	// Vitest sets NODE_ENV=test, which would select React's development build.
	const env = process.env.NODE_ENV;
	process.env.NODE_ENV = "production";
	try {
		await build({
			configFile: app("web/vite.config.ts"),
			build: { outDir: join(outDir, "web"), emptyOutDir: true },
			logLevel: "silent",
		});
		for (const mode of ["main", "preload"])
			await build({
				configFile: app("electron.vite.config.ts"),
				mode,
				build: { outDir: join(outDir, "electron") },
				logLevel: "silent",
			});
		const fresh = tree(outDir);
		const committed = tree(app("dist"));
		expect(Object.keys(committed).sort()).toEqual(Object.keys(fresh).sort());
		for (const [path, contents] of Object.entries(fresh)) expect(committed[path] === contents, path).toBe(true);
	} finally {
		process.env.NODE_ENV = env;
		rmSync(outDir, { recursive: true, force: true });
	}
});

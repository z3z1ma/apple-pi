import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { expect, it } from "vitest";

// Git installs omit dev dependencies, so the package ships the built page. It must match its source.
it("the committed page matches a fresh build of web/ (run npm run build:web)", { timeout: 60_000 }, async () => {
	const outDir = mkdtempSync(join(tmpdir(), "browser-pages-build-"));
	// Vitest sets NODE_ENV=test, which would select React's development build.
	const env = process.env.NODE_ENV;
	process.env.NODE_ENV = "production";
	try {
		await build({
			configFile: fileURLToPath(new URL("../web/vite.config.ts", import.meta.url)),
			build: { outDir, emptyOutDir: true },
			logLevel: "silent",
		});
		const fresh = readFileSync(join(outDir, "index.html"), "utf8");
		const committed = readFileSync(fileURLToPath(new URL("../dist/index.html", import.meta.url)), "utf8");
		expect(fresh === committed).toBe(true);
	} finally {
		process.env.NODE_ENV = env;
		rmSync(outDir, { recursive: true, force: true });
	}
});

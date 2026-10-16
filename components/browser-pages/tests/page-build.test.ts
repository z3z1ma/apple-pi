import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { expect, it } from "vitest";

// Git installs omit dev dependencies, so the package ships the built page. It must match its source.
it.each(["code-review", "markdown-review", "ledger-review"])(
	"the committed %s page matches a fresh build of web/ (run npm run build:web)",
	{ timeout: 120_000 },
	async (kind) => {
		const outDir = mkdtempSync(join(tmpdir(), "browser-pages-build-"));
		// Vitest sets NODE_ENV=test, which would select React's development build.
		const env = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			await build({
				configFile: fileURLToPath(new URL("../web/vite.config.ts", import.meta.url)),
				mode: kind,
				build: { outDir, emptyOutDir: true },
				logLevel: "silent",
			});
			const fresh = readFileSync(join(outDir, `${kind}.html`), "utf8");
			const committed = readFileSync(fileURLToPath(new URL(`../dist/${kind}.html`, import.meta.url)), "utf8");
			expect(fresh === committed).toBe(true);
		} finally {
			process.env.NODE_ENV = env;
			rmSync(outDir, { recursive: true, force: true });
		}
	},
);

it("the committed Mermaid matches the installed one (run npm run build:web)", () => {
	const installed = readFileSync(
		fileURLToPath(new URL("../../../node_modules/mermaid/dist/mermaid.min.js", import.meta.url)),
	);
	const committed = readFileSync(fileURLToPath(new URL("../dist/mermaid.min.js", import.meta.url)));
	expect(committed.equals(installed)).toBe(true);
});

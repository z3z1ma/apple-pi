import { relative, resolve } from "node:path";

import { defineConfig } from "vite";

const here = import.meta.dirname;

// The mode names the entry: `main` (ESM, the main process) or `preload` (CommonJS, as sandboxed preloads must be).
// Both go to dist/electron/ and are committed, with everything they import bundled except Electron and Node.
export default defineConfig(({ mode }) => ({
	root: resolve(here, "src/electron"),
	plugins: [
		{
			name: "package-source-assets",
			transform(code, id) {
				const assets = [
					"organization/src/roles.ts",
					"browser-pages/src/saved-page.ts",
					"browser-pages/src/markdown-review.ts",
				];
				if (!assets.some((path) => id === resolve(here, "../../components", path))) return;
				// These modules locate shipped assets beside their source, not beside the Electron bundle.
				const source = JSON.stringify(relative(resolve(here, "dist/electron"), id));
				return { code: code.replaceAll("import.meta.url", `new URL(${source}, import.meta.url).href`), map: null };
			},
		},
	],
	build: {
		ssr: resolve(here, "src/electron", `${mode}.ts`),
		outDir: resolve(here, "dist/electron"),
		emptyOutDir: mode === "main", // main builds first
		target: "node24",
		minify: false,
		reportCompressedSize: false,
		rollupOptions: {
			external: ["electron", "@lydell/node-pty", /^node:/],
			output: {
				format: mode === "preload" ? "cjs" : "es",
				entryFileNames: mode === "preload" ? "preload.cjs" : "main.js",
			},
		},
	},
}));

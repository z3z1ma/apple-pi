import { resolve } from "node:path";

import { defineConfig } from "vite";

const here = import.meta.dirname;

// The mode names the entry: `main` (ESM, the main process) or `preload` (CommonJS, as sandboxed preloads must be).
// Both go to dist/electron/ and are committed, with everything they import bundled except Electron and Node.
export default defineConfig(({ mode }) => ({
	root: resolve(here, "src/electron"),
	build: {
		ssr: resolve(here, "src/electron", `${mode}.ts`),
		outDir: resolve(here, "dist/electron"),
		emptyOutDir: mode === "main", // main builds first
		target: "node24",
		minify: false,
		reportCompressedSize: false,
		rollupOptions: {
			external: ["electron", /^node:/],
			output: {
				format: mode === "preload" ? "cjs" : "es",
				entryFileNames: mode === "preload" ? "preload.cjs" : "main.js",
			},
		},
	},
}));

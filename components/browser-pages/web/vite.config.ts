import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const here = import.meta.dirname;

// The mode names the page to build. Each kind is its own self-contained file, so only the Markdown page carries Mermaid.
export default defineConfig(({ mode }) => ({
	root: here,
	plugins: [react(), viteSingleFile()],
	build: {
		outDir: resolve(here, "../dist"),
		emptyOutDir: false,
		reportCompressedSize: false,
		rollupOptions: { input: resolve(here, `${mode}.html`) },
	},
}));

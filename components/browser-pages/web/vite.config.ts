import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const here = import.meta.dirname;

export default defineConfig({
	root: here,
	plugins: [react(), viteSingleFile()],
	build: { outDir: resolve(here, "../dist"), emptyOutDir: true, reportCompressedSize: false },
});

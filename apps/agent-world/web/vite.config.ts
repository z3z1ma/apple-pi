import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = import.meta.dirname;

// The world UI, built into dist/web and committed. Theme art is not bundled: Electron serves themes/ beside it.
export default defineConfig({
	root: here,
	base: "./",
	plugins: [react()],
	build: {
		outDir: resolve(here, "../dist/web"),
		emptyOutDir: true,
		target: "es2022",
		reportCompressedSize: false,
		chunkSizeWarningLimit: 4096,
		rollupOptions: {
			output: {
				entryFileNames: "assets/[name].js",
				chunkFileNames: "assets/[name].js",
				assetFileNames: "assets/[name][extname]",
			},
		},
	},
});

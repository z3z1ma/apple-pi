import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { PAGE_DATA_MARKER } from "./page-data.js";

const TEMPLATE = fileURLToPath(new URL("../dist/index.html", import.meta.url));

/** The built single-file page app. */
export function readTemplate(): Promise<string> {
	return readFile(TEMPLATE, "utf8");
}

/** Inlines page data into the app, escaped so the JSON cannot close its script element. */
export function embedPage(template: string, data: unknown): string {
	if (!template.includes(PAGE_DATA_MARKER)) throw new Error("The page template has no data marker.");
	const json = JSON.stringify(data)
		.replace(/</g, "\\u003c")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
	return template.replace(PAGE_DATA_MARKER, () => `<script id="page-data" type="application/json">${json}</script>`);
}

function slug(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80)
			.replace(/-+$/, "") || "page"
	);
}

/** Writes a self-contained page to `<agent dir>/artifacts/<project>/<date>-<slug>.html` and returns its path. */
export async function savePage(html: string, root: string, title: string, when = new Date()): Promise<string> {
	const dir = join(getAgentDir(), "artifacts", basename(root));
	await mkdir(dir, { recursive: true });
	const stem = `${when.toISOString().slice(0, 10)}-${slug(title)}`;
	for (let n = 1; ; n++) {
		const path = join(dir, `${stem}${n === 1 ? "" : `-${n}`}.html`);
		try {
			await writeFile(path, html, { flag: "wx" });
			return path;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
}

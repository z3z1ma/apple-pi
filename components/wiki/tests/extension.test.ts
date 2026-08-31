import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installWiki } from "../src/installer.js";
import { WIKI_SYSTEM_PROMPT_TAG } from "../src/system-prompt.js";

const roots: string[] = [];

function createProject(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-wiki-extension-"));
	roots.push(root);
	mkdirSync(join(root, ".git"));
	for (const [path, content] of Object.entries(files)) {
		const absolute = join(root, path);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, content, "utf8");
	}
	return root;
}

function captureWikiExtension() {
	const tools = new Map<string, any>();
	const handlers = new Map<string, (...args: any[]) => unknown>();
	installWiki({
		registerTool: (tool: any) => tools.set(tool.name, tool),
		on: (event: string, handler: (...args: any[]) => unknown) => handlers.set(event, handler),
	} as any);
	return { tools, handlers };
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("wiki extension", () => {
	it("registers one prompt hook and exactly two read-only graph tools", () => {
		const { tools, handlers } = captureWikiExtension();
		expect([...tools.keys()]).toEqual(["wiki_lint", "wiki_references"]);
		expect([...handlers.keys()]).toEqual(["before_agent_start"]);

		const prompt = handlers.get("before_agent_start")?.({ systemPrompt: "root" }) as { systemPrompt: string };
		expect(prompt.systemPrompt).toContain(`<${WIKI_SYSTEM_PROMPT_TAG}>`);
		expect(prompt.systemPrompt).toContain("wiki_lint");
		expect(prompt.systemPrompt).toContain("wiki_references");

		const references = tools.get("wiki_references");
		expect(references.parameters.properties.depth.minimum).toBe(1);
		expect(references.parameters.properties.depth.maximum).toBe(2);
		expect(references.parameters.properties.direction.enum).toEqual(["inbound", "outbound", "both"]);
	});

	it("executes lint and graph retrieval against the project wiki", async () => {
		const root = createProject({
			".wiki/pages/a.md": "[[b#Details]]\n",
			".wiki/pages/b.md": "# B\n\n## Details\n",
		});
		const { tools } = captureWikiExtension();
		const ctx = { cwd: root } as any;

		const lint = await tools.get("wiki_lint").execute("lint-1", {}, undefined, undefined, ctx);
		expect(lint.content[0].text).toContain("Wiki lint passed");
		expect(lint.details).toMatchObject({ status: "passed", pageCount: 2, linkCount: 1, findingCount: 0 });

		const references = await tools
			.get("wiki_references")
			.execute("refs-1", { target: "b", direction: "inbound", depth: 1 }, undefined, undefined, ctx);
		expect(references.content[0].text).toContain(".wiki/pages/a.md:1:1 [[b#Details]] -> .wiki/pages/b.md");
		expect(references.details).toMatchObject({ status: "references", nodeCount: 2, edgeCount: 1 });
	});

	it("renders an empty heading fragment explicitly", async () => {
		const root = createProject({
			".wiki/pages/a.md": "[[b#]]\n",
			".wiki/pages/b.md": "# B\n",
		});
		const { tools } = captureWikiExtension();

		const lint = await tools
			.get("wiki_lint")
			.execute("lint-empty-heading", {}, undefined, undefined, { cwd: root } as any);

		expect(lint.content[0].text).toContain('missing heading "" in .wiki/pages/b.md');
		expect(lint.details).toMatchObject({ status: "findings", findingCount: 1 });
	});
});

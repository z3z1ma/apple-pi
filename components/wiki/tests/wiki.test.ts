import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getWikiReferences, lintWiki } from "../src/graph.js";

const roots: string[] = [];

function createProject(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-wiki-"));
	roots.push(root);
	mkdirSync(join(root, ".git"));
	for (const [path, content] of Object.entries(files)) {
		const absolute = join(root, path);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, content, "utf8");
	}
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("wiki graph", () => {
	it("lints case-insensitive filename-stem links while ignoring non-page examples", async () => {
		const root = createProject({
			".wiki/README.md": "# Wiki\n\nStart with [[order]].\n",
			".wiki/pages/order.md": [
				"# Order",
				"",
				"See [[customer#Rules|the customer]].",
				"`[[not-a-page]]`",
				"",
				"```md",
				"[[also-not-a-page]]",
				"```",
				"",
				"[ordinary Markdown](missing.md)",
				"![[diagram.png]]",
				"",
			].join("\n"),
			".wiki/pages/Customer.md": "# Customer\n\n## Rules\n",
		});

		const result = await lintWiki(root);

		expect(result.ok).toBe(true);
		expect(result.pageCount).toBe(3);
		expect(result.linkCount).toBe(2);
		expect(result.findings).toEqual([]);
	});

	it("reports duplicate, ambiguous, and unresolved slugs with evidence", async () => {
		const root = createProject({
			".wiki/INDEX.md": "See [[ORDER]] and [[missing]].\n",
			".wiki/pages/Order.md": "# Current order\n",
			".wiki/archive/order.md": "# Old order\n",
		});

		const result = await lintWiki(root);

		expect(result.ok).toBe(false);
		expect(result.findings.map((finding) => finding.kind)).toEqual([
			"duplicate-slug",
			"ambiguous-link",
			"unresolved-link",
		]);
		expect(result.findings[0]).toMatchObject({
			kind: "duplicate-slug",
			slug: "order",
			paths: [".wiki/archive/order.md", ".wiki/pages/Order.md"],
		});
		expect(result.findings[1]).toMatchObject({
			kind: "ambiguous-link",
			path: ".wiki/INDEX.md",
			line: 1,
			target: "ORDER",
		});
		expect(result.findings[2]).toMatchObject({
			kind: "unresolved-link",
			path: ".wiki/INDEX.md",
			line: 1,
			target: "missing",
		});
	});

	it("reports missing and empty target headings while preserving page relationships", async () => {
		const root = createProject({
			".wiki/pages/a.md": "[[b#Known]] and [[b#Missing]] and [[b#]].\n",
			".wiki/pages/b.md": "# B\n\n## Known\n",
		});

		const result = await lintWiki(root);

		expect(result.linkCount).toBe(3);
		expect(result.findings).toEqual([
			expect.objectContaining({
				kind: "missing-heading",
				path: ".wiki/pages/a.md",
				target: "b",
				fragment: "Missing",
				paths: [".wiki/pages/b.md"],
			}),
			expect.objectContaining({
				kind: "missing-heading",
				path: ".wiki/pages/a.md",
				target: "b",
				fragment: undefined,
				paths: [".wiki/pages/b.md"],
			}),
		]);
		const references = await getWikiReferences(root, "a", "outbound", 1);
		expect(references.nodes.map(({ path }) => path)).toEqual([".wiki/pages/a.md", ".wiki/pages/b.md"]);
	});

	it("recognizes Markdown page embeds but excludes unresolved non-Markdown attachments", async () => {
		const root = createProject({
			".wiki/pages/a.md": "[[diagram.png]] ![[diagram.png]] ![[customer]] [[missing.pdf]]\n",
			".wiki/pages/diagram.png.md": "# Diagram page\n",
			".wiki/pages/customer.md": "# Customer\n",
		});

		const result = await lintWiki(root);

		expect(result.ok).toBe(true);
		expect(result.linkCount).toBe(3);
		expect(result.findings).toEqual([]);
		const references = await getWikiReferences(root, "a", "outbound", 1);
		expect(references.edges.map(({ to }) => to)).toEqual([
			".wiki/pages/diagram.png.md",
			".wiki/pages/diagram.png.md",
			".wiki/pages/customer.md",
		]);
	});

	it("ignores indented, container-fenced, multiline-inline, and unclosed fenced code examples", async () => {
		const root = createProject({
			".wiki/pages/a.md": [
				"    [[indented]]",
				"> ```md",
				"> [[quoted]]",
				"> ```",
				"- ```md",
				"  [[listed]]",
				"  ```",
				"`inline code starts",
				"[[multiline]]",
				"and ends`",
				"```md",
				"[[fenced]]",
				"``` trailing text",
				"[[still-fenced]]",
				"```",
				"  [[b]]",
			].join("\n"),
			".wiki/pages/b.md": "# B\n",
		});

		const result = await lintWiki(root);

		expect(result.ok).toBe(true);
		expect(result.linkCount).toBe(1);
		const references = await getWikiReferences(root, "a", "outbound", 1);
		expect(references.edges).toEqual([
			expect.objectContaining({ line: 16, column: 3, raw: "[[b]]", to: ".wiki/pages/b.md" }),
		]);
	});

	it("resets multiline inline-code state at block-code boundaries", async () => {
		const root = createProject({
			".wiki/pages/a.md": [
				"`open before indented code",
				"    [[ignored-indented]]",
				"[[b#B]]",
				"`open before fenced code",
				"```md",
				"[[ignored-fenced]]",
				"```",
				"[[c]]",
			].join("\n"),
			".wiki/pages/b.md": "`open before fenced code\n```md\n# ignored\n```\n# B\n",
			".wiki/pages/c.md": "# C\n",
		});

		const result = await lintWiki(root);

		expect(result.ok).toBe(true);
		expect(result.linkCount).toBe(2);
		const references = await getWikiReferences(root, "a", "outbound", 1);
		expect(references.edges).toEqual([
			expect.objectContaining({ line: 3, raw: "[[b#B]]", to: ".wiki/pages/b.md" }),
			expect.objectContaining({ line: 8, raw: "[[c]]", to: ".wiki/pages/c.md" }),
		]);
	});

	it("resolves inline-code text and optional closing markers in ATX and Setext headings", async () => {
		const root = createProject({
			".wiki/pages/a.md": ["[[b#Open]]", "[[b#Retries]]", "[[b#prefix Retries]]", "[[b#C#]]", "[[b#Backoff]]"].join(
				"\n",
			),
			".wiki/pages/b.md": [
				"## `Open`",
				"## `Retries` #",
				"## prefix `Retries` #",
				"## `C#` #",
				"",
				"`Backoff`",
				"---",
			].join("\n"),
		});

		const result = await lintWiki(root);

		expect(result.findings).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.linkCount).toBe(5);
	});

	it("does not register multiline inline-code text as a heading and preserves UTF-16 link columns", async () => {
		const root = createProject({
			".wiki/pages/a.md": "[[b#fake too]]\n😀`[[ignored]]` [[b]]\n",
			".wiki/pages/b.md": "`# fake\n# fake too`\n# Actual\n",
		});

		const result = await lintWiki(root);

		expect(result.linkCount).toBe(2);
		expect(result.findings).toEqual([
			expect.objectContaining({ kind: "missing-heading", target: "b", fragment: "fake too" }),
		]);
		const references = await getWikiReferences(root, "a", "outbound", 1);
		expect(references.edges).toContainEqual(expect.objectContaining({ line: 2, column: 17, raw: "[[b]]" }));
	});

	it("does not treat YAML frontmatter delimiters as Setext headings", async () => {
		const root = createProject({
			".wiki/pages/a.md": "[[b#title: Metadata]] and [[b#Actual]].\n",
			".wiki/pages/b.md": "---\ntitle: Metadata\n---\n\n# Actual\n",
		});

		const result = await lintWiki(root);

		expect(result.linkCount).toBe(2);
		expect(result.findings).toEqual([
			expect.objectContaining({
				kind: "missing-heading",
				path: ".wiki/pages/a.md",
				target: "b",
				fragment: "title: Metadata",
				paths: [".wiki/pages/b.md"],
			}),
		]);
	});

	it("validates same-page heading links without treating an empty page target as another slug", async () => {
		const root = createProject({
			".wiki/pages/a.md": "# Present\n\n[[#Present]] and [[#Missing]].\n",
		});

		const result = await lintWiki(root);

		expect(result.linkCount).toBe(2);
		expect(result.findings).toEqual([
			expect.objectContaining({
				kind: "missing-heading",
				path: ".wiki/pages/a.md",
				target: "",
				fragment: "Missing",
				paths: [".wiki/pages/a.md"],
			}),
		]);
	});

	it("reports an empty page target without a heading as unresolved", async () => {
		const root = createProject({
			".wiki/pages/a.md": "[[#]]\n",
		});

		const result = await lintWiki(root);

		expect(result.linkCount).toBe(1);
		expect(result.findings).toEqual([
			expect.objectContaining({
				kind: "unresolved-link",
				path: ".wiki/pages/a.md",
				target: "",
				raw: "[[#]]",
			}),
		]);
	});

	it("traverses directed inbound, outbound, and bidirectional neighborhoods", async () => {
		const root = createProject({
			".wiki/pages/a.md": "[[b]]\n",
			".wiki/pages/b.md": "[[d]]\n",
			".wiki/pages/c.md": "[[B]]\n",
			".wiki/pages/d.md": "[[e]]\n",
			".wiki/pages/e.md": "# E\n",
		});

		const inbound = await getWikiReferences(root, "B", "inbound", 1);
		expect(inbound.nodes.map(({ path, distance }) => [path, distance])).toEqual([
			[".wiki/pages/b.md", 0],
			[".wiki/pages/a.md", 1],
			[".wiki/pages/c.md", 1],
		]);
		expect(inbound.edges.map(({ from, to }) => [from, to])).toEqual([
			[".wiki/pages/a.md", ".wiki/pages/b.md"],
			[".wiki/pages/c.md", ".wiki/pages/b.md"],
		]);

		const outbound = await getWikiReferences(root, ".wiki/pages/b.md", "outbound", 1);
		expect(outbound.nodes.map(({ path, distance }) => [path, distance])).toEqual([
			[".wiki/pages/b.md", 0],
			[".wiki/pages/d.md", 1],
		]);

		const both = await getWikiReferences(root, "b", "both", 2);
		expect(both.nodes.map(({ path, distance }) => [path, distance])).toEqual([
			[".wiki/pages/b.md", 0],
			[".wiki/pages/a.md", 1],
			[".wiki/pages/c.md", 1],
			[".wiki/pages/d.md", 1],
			[".wiki/pages/e.md", 2],
		]);
		expect(both.edges.map(({ from, to }) => [from, to])).toEqual([
			[".wiki/pages/a.md", ".wiki/pages/b.md"],
			[".wiki/pages/b.md", ".wiki/pages/d.md"],
			[".wiki/pages/c.md", ".wiki/pages/b.md"],
			[".wiki/pages/d.md", ".wiki/pages/e.md"],
		]);
	});

	it("rejects target traversal and reports symlinks without following them", async () => {
		const root = createProject({
			".wiki/pages/a.md": "# A\n",
			"outside.md": "# Outside\n",
		});
		symlinkSync(join(root, "outside.md"), join(root, ".wiki/pages/outside.md"));

		await expect(getWikiReferences(root, "../a.md", "both", 1)).rejects.toThrow(/inside \.wiki/i);
		const result = await lintWiki(root);
		expect(result.findings).toContainEqual(
			expect.objectContaining({ kind: "unsafe-path", path: ".wiki/pages/outside.md" }),
		);
	});
});

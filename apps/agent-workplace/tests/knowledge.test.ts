import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openKnowledge } from "../src/backend/knowledge.js";
import { openWorkspace } from "../src/backend/workspace.js";

const directories: string[] = [];
function repository() {
	const root = mkdtempSync(join(tmpdir(), "workplace-knowledge-"));
	directories.push(root);
	mkdirSync(join(root, ".git"));
	return root;
}
function put(root: string, path: string, text: string) {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), text);
}
const api = openKnowledge(
	openWorkspace(() => {
		throw new Error("No runtime snapshot required");
	}),
);
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("repository knowledge", () => {
	it("extracts context, verification and wiki edges using the lint parsers, with readable documents and missing targets", async () => {
		const root = repository();
		put(root, "src/main.ts", "export const main = 1;");
		put(root, "src/other.ts", "export const other = 2;");
		put(root, "tests/main.test.ts", "test");
		put(
			root,
			".context/src/main.ts.md",
			"## file\nMain rationale\nCoupled: src/other.ts, missing.ts\nVerify: tests/main.test.ts\n[[Guide#Heading|read]]\n```\nCoupled: ignored.ts\n[[ignored]]\n```\n",
		);
		put(root, ".context/src/other.ts.md", "## file\nOther rationale");
		put(root, ".wiki/pages/Guide.md", "# Heading\n[[Other]]");
		put(root, ".wiki/Other.md", "# Other");
		const result = await api.graph({ root, mode: "context" });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.reason);
		expect(result.value.edges).toEqual([
			{ from: "src/main.ts", to: "src/other.ts", kind: "coupled", line: 3 },
			{ from: "src/main.ts", to: "missing.ts", kind: "coupled", line: 3 },
			{ from: "src/main.ts", to: "tests/main.test.ts", kind: "verify", line: 4 },
			{ from: "src/main.ts", to: ".wiki/pages/Guide.md", kind: "wiki", line: 5 },
		]);
		expect(result.value.nodes.find((node) => node.id === "src/other.ts")?.kind).toBe("context");
		expect(result.value.nodes.find((node) => node.id === "missing.ts")?.kind).toBe("missing");
		expect(result.value.nodes.find((node) => node.id === "tests/main.test.ts")?.source).toBe("tests/main.test.ts");
		const content = await api.content({ root, mode: "context", id: "src/main.ts" });
		expect(content).toMatchObject({
			ok: true,
			value: { node: { source: "src/main.ts" }, text: expect.stringContaining("Main rationale") },
		});
		expect(await api.content({ root, mode: "context", id: "../../private.md" })).toMatchObject({ ok: false });
	});

	it("uses case-insensitive wiki resolution, aliases and headings; reports ambiguous and missing links without choosing a target", async () => {
		const root = repository();
		put(root, ".wiki/Guide.md", "# Guide\n[[other#Heading|next]] [[Absent]] [[Duplicate]]\n`[[ignored]]`\n");
		put(root, ".wiki/Other.md", "# Heading");
		put(root, ".wiki/a/Duplicate.md", "# A");
		put(root, ".wiki/b/duplicate.md", "# B");
		const result = await api.graph({ root, mode: "wiki" });
		if (!result.ok) throw new Error(result.reason);
		expect(result.value.nodes).toHaveLength(4);
		expect(result.value.edges).toEqual([
			expect.objectContaining({ from: ".wiki/Guide.md", to: ".wiki/Other.md", kind: "wiki" }),
		]);
		expect(result.value.warnings.join("\n")).toContain("cannot resolve [[Absent]]");
		expect(result.value.warnings.join("\n")).toContain("multiple pages");
		expect(await api.content({ root, mode: "wiki", id: ".wiki/Other.md" })).toMatchObject({
			ok: true,
			value: { text: "# Heading" },
		});
	});

	it("keeps missing folders empty and refuses symlink roots or outside document reads", async () => {
		const root = repository();
		const outside = repository();
		for (const mode of ["context", "wiki"] as const)
			expect(await api.graph({ root, mode })).toMatchObject({ ok: true, value: { nodes: [], edges: [] } });
		put(outside, "secret.md", "private");
		mkdirSync(join(root, ".context"));
		symlinkSync(join(outside, "secret.md"), join(root, ".context/secret.md"));
		expect(await api.graph({ root, mode: "context" })).toMatchObject({
			ok: true,
			value: { nodes: [], warnings: [expect.stringContaining("symlink")] },
		});
		symlinkSync(outside, join(root, ".wiki"));
		expect(await api.graph({ root, mode: "wiki" })).toMatchObject({ ok: false });
		expect(await api.graph({ root: "relative", mode: "context" })).toMatchObject({ ok: false });
	});
});

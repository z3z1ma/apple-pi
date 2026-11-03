import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { commandRefusal, editRefusal, installRepoRules, proposedContent } from "../src/index.js";

const repo = mkdtempSync(join(tmpdir(), "repo-rules-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));
mkdirSync(join(repo, ".pi/rules"), { recursive: true });
mkdirSync(join(repo, "web"));
writeFileSync(
	join(repo, ".pi/rules/no-select.grit"),
	'language js\n\n`<select $attrs>$children</select>` as $element where {\n  register_diagnostic(span=$element, message="Use the shared Select.")\n}\n',
);
writeFileSync(
	join(repo, ".pi/rules/policy.json"),
	JSON.stringify({
		comments: "forbid",
		rules: [{ plugin: "no-select.grit", includes: ["web/**"] }],
		actions: [{ id: "no-git-rm", pattern: "\\bgit\\s+rm\\b", reason: "Use plain rm." }],
	}),
);
const file = join(repo, "web/view.tsx");
writeFileSync(file, "// biome-ignore lint: kept\nexport const a = 1;\n// an old comment stays\nexport const b = 2;\n");

test("an edit is computed against the file the way the edit tool applies it", () => {
	expect(proposedContent(file, { edits: [{ oldText: "a = 1", newText: "a = 3" }] }, "edit")).toContain("a = 3");
	expect(proposedContent(file, { edits: [{ oldText: "absent", newText: "x" }] }, "edit")).toBeUndefined();
	expect(proposedContent(file, { content: "x" }, "write")).toBe("x");
});

test("in an opted-in repository a new comment is refused, with where its rationale belongs", async () => {
	const refusal = await editRefusal(file, "edit", {
		edits: [{ oldText: "export const b = 2;", newText: "// why b is two\nexport const b = 2;" }],
	});
	expect(refusal).toMatch(/why b is two/);
	expect(refusal).toMatch(/\.context\/<path>\.md/);
	expect(
		await editRefusal(file, "edit", { edits: [{ oldText: "export const b = 2;", newText: "export const b = 4;" }] }),
	).toBeUndefined();
});

test("a repository's GritQL rule refuses the change on the paths it lists", async () => {
	const select = "export const V = () => <select><option>x</option></select>;\n";
	expect(await editRefusal(file, "write", { content: select })).toMatch(/Use the shared Select/);
	expect(await editRefusal(join(repo, "elsewhere.tsx"), "write", { content: select })).toBeUndefined();
});

test("outside an opted-in repository nothing is checked", async () => {
	const plain = mkdtempSync(join(tmpdir(), "repo-rules-plain-"));
	try {
		expect(await editRefusal(join(plain, "a.ts"), "write", { content: "// fine here\n" })).toBeUndefined();
		expect(commandRefusal(plain, "git rm a.ts")).toBeUndefined();
	} finally {
		rmSync(plain, { recursive: true, force: true });
	}
});

test("action rules refuse matching commands, and a commit beside an edit is refused in any repository", async () => {
	expect(commandRefusal(repo, "git rm web/view.tsx")).toMatch(/no-git-rm/);
	const handlers = new Map<string, (event: any, ctx?: any) => any>();
	installRepoRules({ on: (name: string, handler: any) => handlers.set(name, handler) } as never);
	const ctx = { cwd: tmpdir() };
	handlers.get("message_end")!({
		message: {
			role: "assistant",
			content: [
				{ type: "toolCall", id: "e1", name: "edit" },
				{ type: "toolCall", id: "b1", name: "bash" },
			],
		},
	});
	const commit = await handlers.get("tool_call")!(
		{ toolName: "bash", toolCallId: "b1", input: { command: "git commit -m x" } },
		ctx,
	);
	expect(commit?.block).toBe(true);
	handlers.get("message_end")!({
		message: { role: "assistant", content: [{ type: "toolCall", id: "b2", name: "bash" }] },
	});
	expect(
		await handlers.get("tool_call")!(
			{ toolName: "bash", toolCallId: "b2", input: { command: "git commit -m x" } },
			ctx,
		),
	).toBeUndefined();
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { commandRefusal, editRefusal, installRepoRules, rulesReport } from "../src/index.js";

const NO_SELECT =
	'language js\n\n`<select $attrs>$children</select>` as $element where {\n  register_diagnostic(span=$element, message="Use the shared Select.")\n}\n';
const SELECT_RULE = {
	plugin: "no-select.grit",
	includes: ["web/**"],
	fires: "export const V = () => <select><option>x</option></select>;\n",
	passes: "export const V = () => <Select />;\n",
};
const GIT_RM = {
	id: "no-git-rm",
	pattern: "\\bgit\\s+rm\\b",
	reason: "Use plain rm.",
	fires: "git rm a",
	passes: "rm a",
};

const repo = mkdtempSync(join(tmpdir(), "repo-rules-"));
const agent = mkdtempSync(join(tmpdir(), "repo-rules-agent-"));
const rulesDir = join(repo, ".pi/rules");
const policyFile = join(rulesDir, "policy.json");
beforeAll(() => vi.stubEnv("PI_CODING_AGENT_DIR", agent));
afterAll(() => {
	vi.unstubAllEnvs();
	rmSync(repo, { recursive: true, force: true });
	rmSync(agent, { recursive: true, force: true });
});
mkdirSync(rulesDir, { recursive: true });
mkdirSync(join(repo, "web"));
writeFileSync(join(rulesDir, "no-select.grit"), NO_SELECT);
writeFileSync(policyFile, JSON.stringify({ comments: "forbid", rules: [SELECT_RULE], actions: [GIT_RM] }));
const file = join(repo, "web/view.tsx");
writeFileSync(file, "// biome-ignore lint: kept\nexport const a = 1;\n// an old comment stays\nexport const b = 2;\n");

test("an edit that would fail to apply is left to the edit tool to report", async () => {
	expect(
		await editRefusal(file, "edit", { edits: [{ oldText: "absent", newText: "// new comment\n" }] }),
	).toBeUndefined();
});

test("in an opted-in repository a new comment is refused, wherever it sits, with where its rationale belongs", async () => {
	const refusal = await editRefusal(file, "edit", {
		edits: [{ oldText: "export const b = 2;", newText: "// why b is two\nexport const b = 2;" }],
	});
	expect(refusal).toMatch(/why b is two/);
	expect(refusal).toMatch(/\.context\/<path>\.md/);
	const afterComma = await editRefusal(file, "edit", {
		edits: [{ oldText: "export const b = 2;", newText: "export const b = [\n\t{ x: 1 }, // weak match\n];" }],
	});
	expect(afterComma).toMatch(/weak match/);
	const inJsx = await editRefusal(file, "write", {
		content:
			'export const V = () => (\n\t<div>\n\t\t{/* a jsx note */}\n\t\t<a href="http://x">http://x</a>\n\t</div>\n);\n',
	});
	expect(inJsx).toMatch(/a jsx note/);
	expect(inJsx).not.toMatch(/http:\/\/x/);
	expect(
		await editRefusal(file, "edit", { edits: [{ oldText: "export const b = 2;", newText: "export const b = 4;" }] }),
	).toBeUndefined();
});

test("a repository's GritQL rule refuses the change on the paths it lists, and its firings are counted", async () => {
	const select = "export const V = () => <select><option>x</option></select>;\n";
	expect(await editRefusal(file, "write", { content: select })).toMatch(/Use the shared Select/);
	expect(await editRefusal(join(repo, "elsewhere.tsx"), "write", { content: select })).toBeUndefined();
	expect(rulesReport(repo)).toMatch(/code no-select\.grit: fired 1 times/);
	expect(rulesReport(repo)).toMatch(/policy comments: fired \d+ times/);
});

test("a rule is checked when it is written: it must load, flag its fires sample and allow its passes sample", async () => {
	expect(await editRefusal(policyFile, "write", { content: JSON.stringify({ rules: [SELECT_RULE] }) })).toBeUndefined();
	const noSamples = await editRefusal(policyFile, "write", {
		content: JSON.stringify({ rules: [{ plugin: "no-select.grit", includes: ["web/**"] }] }),
	});
	expect(noSamples).toMatch(/give it a "fires" sample/);
	const tooBroad = await editRefusal(join(rulesDir, "no-select.grit"), "write", {
		content:
			'language js\n\n`$x` as $element where {\n  $x <: r"^V$",\n  register_diagnostic(span=$element, message="Use the shared Select.")\n}\n',
	});
	expect(tooBroad).toMatch(/flags its "passes" sample/);
	const broken = await editRefusal(join(rulesDir, "no-select.grit"), "write", {
		content: "language js\n\n`foo($x)` as $c where { $x <: not within }\n",
	});
	expect(broken).toMatch(/does not run/);
	const badAction = await editRefusal(policyFile, "write", {
		content: JSON.stringify({ actions: [{ ...GIT_RM, passes: "git rm b" }] }),
	});
	expect(badAction).toMatch(/action no-git-rm refuses its "passes" command/);
	expect(await editRefusal(policyFile, "write", { content: "{ not json" })).toMatch(/not valid JSON/);
});

test("outside an opted-in repository nothing is checked", async () => {
	const plain = mkdtempSync(join(tmpdir(), "repo-rules-plain-"));
	try {
		expect(await editRefusal(join(plain, "a.ts"), "write", { content: "// fine here\n" })).toBeUndefined();
		expect(commandRefusal(plain, "git rm a.ts")).toBeUndefined();
		expect(rulesReport(plain)).toMatch(/has not opted in/);
	} finally {
		rmSync(plain, { recursive: true, force: true });
	}
});

test("action rules refuse matching commands, and a commit beside an edit is refused in any repository", async () => {
	expect(commandRefusal(repo, "git rm web/view.tsx")).toMatch(/no-git-rm/);
	expect(rulesReport(repo)).toMatch(/action no-git-rm: fired 1 times/);
	const handlers = new Map<string, (event: any, ctx?: any) => any>();
	installRepoRules({
		on: (name: string, handler: any) => handlers.set(name, handler),
		registerTool: () => undefined,
	} as never);
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

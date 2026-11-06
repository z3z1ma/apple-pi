import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { ruleFileRefusal } from "../src/checks.js";
import { checkCall, checkEdit, rulesReport } from "../src/index.js";
import { existingRule } from "../src/replay.js";

const base = mkdtempSync(join(tmpdir(), "rules-robust-"));
const agent = join(base, "agent");
const userRules = join(agent, "rules");
let count = 0;

beforeAll(() => vi.stubEnv("PI_CODING_AGENT_DIR", agent));
afterEach(() => rmSync(userRules, { recursive: true, force: true }));
afterAll(() => {
	vi.unstubAllEnvs();
	rmSync(base, { recursive: true, force: true });
});

function repository(policy?: unknown, files: Record<string, string> = {}) {
	const root = join(base, `repo-${count++}`);
	mkdirSync(join(root, "src"), { recursive: true });
	if (policy !== undefined) {
		mkdirSync(join(root, ".pi/rules"), { recursive: true });
		writeFileSync(join(root, ".pi/rules/policy.json"), typeof policy === "string" ? policy : JSON.stringify(policy));
	}
	for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
	return root;
}

function userPolicy(policy: unknown, files: Record<string, string> = {}) {
	mkdirSync(userRules, { recursive: true });
	writeFileSync(join(userRules, "policy.json"), typeof policy === "string" ? policy : JSON.stringify(policy));
	for (const [name, content] of Object.entries(files)) writeFileSync(join(userRules, name), content);
}

const call = (name: string, args: Record<string, unknown>, id = name) => ({ id, name, arguments: args });
const alone = (root: string, each: ReturnType<typeof call>) => checkCall(each, [each], root, false);
const script = (id: string, on: "call" | "edit", extra: Record<string, unknown> = {}) => ({
	id,
	on,
	script: `${id}.js`,
	...extra,
});

test("a policy.json that does not parse refuses ordinary calls by name and can still be replaced", async () => {
	for (const level of ["project", "user"] as const) {
		const root = level === "project" ? repository("{ broken") : repository();
		if (level === "user") userPolicy("{ broken");
		const policy = level === "project" ? join(root, ".pi/rules/policy.json") : join(userRules, "policy.json");
		expect(await alone(root, call("read", { path: "src/a.ts" }))).toMatch(/\[policy\.json\] .*does not load/);
		expect(rulesReport(root)).toMatch(/does not load.*every call is refused until it is fixed/);
		expect(await alone(root, call("write", { path: policy, content: "{}" }))).toBeUndefined();
		expect(await checkEdit(policy, "write", { content: "{}" })).toBeUndefined();
		expect(await alone(root, call("write", { path: policy, content: "{ still" }))).toMatch(/not valid JSON/);
		rmSync(userRules, { recursive: true, force: true });
	}
});

test("your own path-scoped edit rules see repository-relative paths where the repository has no rules", async () => {
	userPolicy(
		{
			scripts: [
				script("src-only", "edit", {
					includes: ["src/**"],
					fires: [{ path: "src/a.ts", content: "x" }],
					passes: [{ path: "docs/a.md", content: "x" }],
				}),
			],
		},
		{ "src-only.js": "return event.path.startsWith('src/') && 'in ' + event.path;" },
	);
	const root = repository();
	expect(await alone(root, call("write", { path: "src/a.ts", content: "x" }))).toMatch(/\[src-only\] in src\/a\.ts/);
	expect(await alone(root, call("write", { path: "docs.md", content: "x" }))).toBeUndefined();
});

test("each script judges the event as given, whatever another script did to it", async () => {
	const root = repository({ scripts: [script("a-mutates", "call"), script("b-reads", "call")] }, {});
	writeFileSync(join(root, ".pi/rules/a-mutates.js"), "event.tool = 'bash'; event.batch.length = 0;");
	writeFileSync(
		join(root, ".pi/rules/b-reads.js"),
		"return event.tool === 'read' && event.batch.length === 1 && 'read';",
	);
	expect(await alone(root, call("read", { path: "src/a.ts" }))).toMatch(/\[b-reads\] read/);
});

test("an edit is refused for every rule it breaks, edit and call rules alike, and each fires", async () => {
	const root = repository(
		{ comments: "forbid", scripts: [script("no-writes", "call")] },
		{ "src/a.ts": "export const a = 1;\n" },
	);
	writeFileSync(join(root, ".pi/rules/no-writes.js"), "return event.tool === 'write' && 'no writes';");
	const refusal = await alone(root, call("write", { path: "src/a.ts", content: "// note\nexport const a = 2;\n" }));
	expect(refusal).toMatch(/\[comments\]/);
	expect(refusal).toMatch(/\[no-writes\] no writes/);
	expect(rulesReport(root)).toMatch(/script no-writes .*fired 1 times/);
});

test("a broken action pattern is reported by name beside the rules that match", async () => {
	const root = repository({
		actions: [
			{ id: "first", pattern: "rm", reason: "no rm" },
			{ id: "bad", pattern: "[", reason: "x" },
		],
	});
	const refusal = await alone(root, call("bash", { command: "rm a" }));
	expect(refusal).toMatch(/\[first\] no rm/);
	expect(refusal).toMatch(/\[bad\] pattern does not compile/);
});

test("a configured script whose file is missing refuses by name instead of going quiet", async () => {
	const root = repository({ scripts: [script("gone", "call")] });
	expect(await alone(root, call("read", { path: "src/a.ts" }))).toMatch(/\[gone\] could not read .*gone\.js/);
});

test("the repair exemption follows the file a path names, not the directory it is spelled in", async () => {
	const root = repository({ comments: "forbid", scripts: [script("refuse", "call")] }, { "app.ts": "x\n" });
	writeFileSync(join(root, ".pi/rules/refuse.js"), "return 'refused';");
	symlinkSync(join(root, "app.ts"), join(root, ".pi/rules/app.ts"));
	symlinkSync(join(root, ".pi/rules/refuse.js"), join(root, "rule-link.js"));
	expect(await alone(root, call("write", { path: ".pi/rules/app.ts", content: "// x\n" }))).toMatch(/\[refuse\]/);
	expect(await alone(root, call("write", { path: "rule-link.js", content: "return;" }))).toBeUndefined();
});

test("any rule id works, including ones that name object internals", async () => {
	const root = repository({
		scripts: [
			script("__proto__", "call", {
				fires: [{ tool: "read", input: { path: "a" } }],
				passes: [{ tool: "ls", input: { path: "a" } }],
			}),
		],
	});
	writeFileSync(join(root, ".pi/rules/__proto__.js"), "return event.tool === 'read' && 'proto';");
	const policy = join(root, ".pi/rules/policy.json");
	expect(await ruleFileRefusal(policy, readFileSync(policy, "utf8"))).toBeUndefined();
	expect(await alone(root, call("read", { path: "src/a.ts" }))).toMatch(/\[__proto__\] proto/);
});

test("edits the edit tool accepts after normalizing line endings or quotes are still checked", async () => {
	const root = repository(
		{ comments: "forbid" },
		{ "src/a.ts": "export const a = \u201cx\u201d;\r\nexport const b = 1;\r\n" },
	);
	const refusal = await alone(
		root,
		call("edit", {
			path: "src/a.ts",
			edits: [{ oldText: 'export const a = "x";\nexport const b = 1;', newText: "// note\nexport const b = 2;" }],
		}),
	);
	expect(refusal).toMatch(/\[comments\] line 1: comment "\/\/ note"/);
});

test("a nested call sample cannot carry a batch a nested call never sees", async () => {
	const root = repository({});
	writeFileSync(join(root, ".pi/rules/nested.js"), "return event.nested && event.batch.length > 1;");
	const policy = {
		scripts: [
			script("nested", "call", {
				fires: [{ tool: "read", nested: true, input: { path: "a" }, batch: [{ tool: "edit", input: { path: "a" } }] }],
				passes: [{ tool: "read", input: { path: "a" } }],
			}),
		],
	};
	expect(await ruleFileRefusal(join(root, ".pi/rules/policy.json"), JSON.stringify(policy))).toMatch(
		/a nested call sample has no batch/,
	);
});

test("replaying an existing rule by id names its level and refuses an ambiguous id", async () => {
	const rule = script("same", "call", { fires: [], passes: [] });
	const root = repository({ scripts: [rule] });
	writeFileSync(join(root, ".pi/rules/same.js"), "return 'project';");
	userPolicy({ scripts: [rule] }, { "same.js": "return 'user';" });
	expect(() => existingRule(root, "same")).toThrow(/names 2 rules; choose one: user:same, project:same/);
	expect(existingRule(root, "project:same")).toMatchObject({ source: "project:same", script: "return 'project';" });
});

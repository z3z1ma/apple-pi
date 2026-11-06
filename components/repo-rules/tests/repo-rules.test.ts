import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { checkCall, checkEdit as editRefusal, rulesReport } from "../src/index.js";

const commandRefusal = (cwd: string, command: string) =>
	checkCall({ id: "c", name: "bash", arguments: { command } }, [], cwd, false);

const NO_SELECT = "language js\n\n`<select $attrs>$children</select>`\n";
const SELECT_RULE = {
	grit: "no-select.grit",
	message: "Use the shared Select.",
	includes: ["web/**"],
	fires: "export const V = () => <select><option>x</option></select>;\n",
	passes: "export const V = () => <Select />;\n",
};
const NO_PRINT = "language python\n\n`print($message)`\n";
const PRINT_RULE = {
	grit: "no-print.grit",
	message: "Log through the logger, not print.",
	includes: ["**/*.py"],
	fires: "def run():\n    print('started')\n",
	passes: "def run():\n    log.info('started')\n",
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
writeFileSync(join(rulesDir, "no-print.grit"), NO_PRINT);
writeFileSync(policyFile, JSON.stringify({ comments: "forbid", rules: [SELECT_RULE, PRINT_RULE], actions: [GIT_RM] }));
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

test("a rule in another language refuses the change with its message and the line it matched", async () => {
	const script = join(repo, "tools/run.py");
	mkdirSync(join(repo, "tools"), { recursive: true });
	const refusal = await editRefusal(script, "write", { content: "def run():\n    x = 1\n    print(x)\n" });
	expect(refusal).toMatch(/line 3: Log through the logger, not print\./);
	expect(await editRefusal(script, "write", { content: "def run():\n    log.info(1)\n" })).toBeUndefined();
});

test("a rule is checked when it is written: it must load, flag its fires sample and allow its passes sample", async () => {
	expect(await editRefusal(policyFile, "write", { content: JSON.stringify({ rules: [SELECT_RULE] }) })).toBeUndefined();
	const noSamples = await editRefusal(policyFile, "write", {
		content: JSON.stringify({ rules: [{ grit: "no-select.grit", message: "x", includes: ["web/**"] }] }),
	});
	expect(noSamples).toMatch(/give it a "fires" sample/);
	const noMessage = await editRefusal(policyFile, "write", {
		content: JSON.stringify({ rules: [{ ...SELECT_RULE, message: "" }] }),
	});
	expect(noMessage).toMatch(/give it a "message"/);
	const tooBroad = await editRefusal(join(rulesDir, "no-select.grit"), "write", {
		content: 'language js\n\n`$x` where {\n  $x <: r"^V$"\n}\n',
	});
	expect(tooBroad).toMatch(/flags its "passes" sample at line 1/);
	const broken = await editRefusal(join(rulesDir, "no-select.grit"), "write", {
		content: "language js\n\n`<select $attrs>$children</select`\n",
	});
	expect(broken).toMatch(/does not run: .*Could not find variable \$attrs/);
	const silent = await editRefusal(join(rulesDir, "no-select.grit"), "write", {
		content: "language js\n\n`foo($x`\n",
	});
	expect(silent).toMatch(/does not flag its "fires" sample\. A query that does not compile/);
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
		expect(await commandRefusal(plain, "git rm a.ts")).toBeUndefined();
		expect(rulesReport(plain)).toMatch(/No rules here/);
	} finally {
		rmSync(plain, { recursive: true, force: true });
	}
});

const TODO_SCRIPT = {
	id: "no-todo",
	on: "edit",
	script: "no-todo.js",
	includes: ["web/**"],
	message: "Finish the work or file it; no TODO markers.",
	fires: [{ path: "web/a.tsx", added: ["export const a = 1; // TODO"] }],
	passes: [{ path: "web/a.tsx", added: ["export const a = 1;"] }],
};
const LS_SCRIPT = {
	id: "no-ls-and-read",
	on: "call",
	script: "no-ls-and-read.js",
	fires: [{ tool: "ls", input: { path: "web" }, batch: [{ tool: "read", input: { path: "web/view.tsx" } }] }],
	passes: [{ tool: "ls", input: { path: "web" } }],
};

test("a script rule is checked when written, and refuses edits and batches it names", async () => {
	writeFileSync(join(rulesDir, "no-todo.js"), 'return event.added.some((text) => text.includes("TODO"));\n');
	writeFileSync(
		join(rulesDir, "no-ls-and-read.js"),
		'if (event.tool === "ls" && event.batch.some((call) => call.tool === "read" && matches(call.path, event.path + "/**")))\n\treturn "list " + event.path + " or read inside it, not both";\n',
	);
	const policy = {
		comments: "forbid",
		rules: [SELECT_RULE, PRINT_RULE],
		actions: [GIT_RM],
		scripts: [TODO_SCRIPT, LS_SCRIPT],
	};
	expect(await editRefusal(policyFile, "write", { content: JSON.stringify(policy) })).toBeUndefined();
	writeFileSync(policyFile, JSON.stringify(policy));
	const lazy = await editRefusal(join(rulesDir, "no-todo.js"), "write", { content: "return false;\n" });
	expect(lazy).toMatch(/script no-todo does not refuse its "fires" sample 1/);
	const throwing = await editRefusal(join(rulesDir, "no-todo.js"), "write", { content: "return event.nope.x;\n" });
	expect(throwing).toMatch(/script no-todo fails on its "fires" sample 1: .*undefined/);
	const syntax = await editRefusal(join(rulesDir, "no-todo.js"), "write", { content: "return (;\n" });
	expect(syntax).toMatch(/script no-todo fails on its "fires" sample 1/);
	const unsampled = await editRefusal(policyFile, "write", {
		content: JSON.stringify({ scripts: [{ ...TODO_SCRIPT, passes: [] }] }),
	});
	expect(unsampled).toMatch(/give it "fires" events it must refuse and "passes" events/);
	const twice = await editRefusal(policyFile, "write", {
		content: JSON.stringify({ actions: [{ ...GIT_RM, id: "no-todo" }], scripts: [TODO_SCRIPT] }),
	});
	expect(twice).toMatch(/two rules share the id no-todo/);

	expect(
		await editRefusal(file, "edit", {
			edits: [{ oldText: "export const b = 2;", newText: "export const b = 3; /* TODO */" }],
		}),
	).toMatch(/\[no-todo\] Finish the work or file it/);
	expect(await editRefusal(join(repo, "other.ts"), "write", { content: "export const TODO = 1;\n" })).toBeUndefined();
	const ls = { id: "l", name: "ls", arguments: { path: "web" } };
	const read = { id: "r", name: "read", arguments: { path: "web/view.tsx" } };
	expect(await checkCall(ls, [ls, read], repo, false)).toMatch(/\[no-ls-and-read\] list web or read inside it/);
	expect(await checkCall(ls, [ls], repo, false)).toBeUndefined();
	expect(rulesReport(repo)).toMatch(/script no-todo \(on edit, no-todo\.js\): fired 1 times/);
});

test("a script that fails at run time refuses with the rule to fix, and a rules-file edit can repair it", async () => {
	writeFileSync(join(rulesDir, "no-ls-and-read.js"), "return event.input.path.missing.x;\n");
	const ls = { id: "l", name: "ls", arguments: { path: "web" } };
	expect(await checkCall(ls, [ls], repo, false)).toMatch(/\[no-ls-and-read\] could not run: .*fix the rule in/);
	const repair = { id: "w", name: "write", arguments: { path: join(rulesDir, "no-ls-and-read.js") } };
	expect(await checkCall(repair, [repair], repo, false)).toBeUndefined();
	writeFileSync(join(rulesDir, "no-ls-and-read.js"), "return;\n");
});

test("rules that refuse everything cannot lock the agent out of fixing them", async () => {
	const todo = join(rulesDir, "no-todo.js");
	const ls = join(rulesDir, "no-ls-and-read.js");
	writeFileSync(todo, 'return "no";\n');
	writeFileSync(ls, 'return "no";\n');
	try {
		const read = { id: "r", name: "read", arguments: { path: "web/view.tsx" } };
		expect(await checkCall(read, [read], repo, false)).toMatch(/\[no-ls-and-read\] no/);
		const fix = { id: "w", name: "write", arguments: { path: ".pi/rules/no-ls-and-read.js" } };
		expect(await checkCall(fix, [fix], repo, false)).toBeUndefined();
		const fixed = await editRefusal(ls, "write", { content: "return;\n" });
		expect(fixed).toMatch(/script no-ls-and-read does not refuse its "fires" sample 1/);
		expect(fixed).not.toMatch(/\[no-todo\]|\[no-ls-and-read\] no/);
	} finally {
		writeFileSync(todo, 'return event.added.some((text) => text.includes("TODO"));\n');
		writeFileSync(ls, "return;\n");
	}
});

test("your own rules in the agent directory apply in every repository", async () => {
	const plain = mkdtempSync(join(tmpdir(), "repo-rules-user-"));
	try {
		mkdirSync(join(agent, "rules"), { recursive: true });
		writeFileSync(join(agent, "rules/policy.json"), JSON.stringify({ actions: [{ ...GIT_RM, id: "mine" }] }));
		expect(await commandRefusal(plain, "git rm a")).toMatch(/\[mine\] Use plain rm/);
		const both = await commandRefusal(repo, "git rm a");
		expect(both).toMatch(/\[mine\]/);
		expect(both).toMatch(/\[no-git-rm\]/);
		expect(rulesReport(plain)).toMatch(/Your rules in .*\n- action mine: fired 2 times/);
		const broken = await editRefusal(join(agent, "rules/policy.json"), "write", {
			content: JSON.stringify({ actions: [{ ...GIT_RM, passes: "git rm b" }] }),
		});
		expect(broken).toMatch(/action no-git-rm refuses its "passes" command/);
	} finally {
		rmSync(join(agent, "rules/policy.json"), { force: true });
		rmSync(plain, { recursive: true, force: true });
	}
});

test("action rules refuse matching commands, also inside scripts, and their firings are counted", async () => {
	expect(await commandRefusal(repo, "git rm web/view.tsx")).toMatch(/\[no-git-rm\] Use plain rm/);
	expect(await checkCall({ id: "n", name: "bash", arguments: { command: "git rm a" } }, [], repo, true)).toMatch(
		/no-git-rm/,
	);
	expect(rulesReport(repo)).toMatch(/action no-git-rm: fired \d+ times/);
});

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { installRepoRules } from "../src/index.js";

const repo = mkdtempSync(join(tmpdir(), "batch-rules-"));
const agent = mkdtempSync(join(tmpdir(), "batch-rules-agent-"));
cpSync(join(import.meta.dirname, "../../../.pi/rules"), join(repo, ".pi/rules"), { recursive: true });
beforeAll(() => vi.stubEnv("PI_CODING_AGENT_DIR", agent));
afterAll(() => {
	vi.unstubAllEnvs();
	rmSync(repo, { recursive: true, force: true });
	rmSync(agent, { recursive: true, force: true });
});

function fixture() {
	const handlers = new Map<string, (event: any, ctx?: any) => any>();
	installRepoRules({
		on: (name: string, handler: any) => handlers.set(name, handler),
		registerTool: () => undefined,
	} as never);
	let messages: unknown[] = [];
	const ctx = {
		cwd: repo,
		sessionManager: {
			getSessionId: () => "batch-test",
			buildSessionProjection: () => ({ messages }),
		},
	};
	const message = (calls: { id: string; name: string; arguments?: Record<string, unknown> }[]) => {
		messages = [{ role: "assistant", content: calls.map((c) => ({ type: "toolCall", ...c })) }];
	};
	const call = (toolName: string, toolCallId: string, input: Record<string, unknown>, parentToolCallId?: string) =>
		handlers.get("tool_call")!({ toolName, toolCallId, input, parentToolCallId }, ctx);
	return { handlers, message, call };
}

const edit = { id: "e", name: "edit", arguments: { path: "batch-a.ts" } };

test("a same-file check is refused even if it starts before its sibling edit", async () => {
	const f = fixture();
	f.message([edit, { id: "r", name: "read", arguments: { path: "./batch-a.ts" } }]);
	const refusal = await f.call("read", "r", { path: "./batch-a.ts" });
	expect(refusal).toMatchObject({ block: true });
	expect(refusal.reason).toMatch(/\[parallel-dependents\] this parallel batch edits batch-a\.ts and also reads it/);
	expect(await f.call("edit", "e", { path: "batch-a.ts", edits: [] })).toBeUndefined();
});

test("a failed or refused edit does not release its sibling check", async () => {
	const f = fixture();
	f.message([edit, { id: "b", name: "bash", arguments: { command: "grep -n fingerprint batch-a.ts" } }]);
	await f.call("edit", "e", { path: "batch-a.ts", edits: [] });
	expect(await f.call("bash", "b", { command: "grep -n fingerprint batch-a.ts" })).toMatchObject({ block: true });
});

test("unrelated reads and shell work remain allowed, and the next batch can check the edited file", async () => {
	const f = fixture();
	f.message([
		edit,
		{ id: "r", name: "read", arguments: { path: "batch-b.ts" } },
		{ id: "b", name: "bash", arguments: { command: "cat batch-b.ts" } },
	]);
	expect(await f.call("read", "r", { path: "batch-b.ts" })).toBeUndefined();
	expect(await f.call("bash", "b", { command: "cat batch-b.ts" })).toBeUndefined();
	f.message([{ id: "r2", name: "read", arguments: { path: "batch-a.ts" } }]);
	expect(await f.call("read", "r2", { path: "batch-a.ts" })).toBeUndefined();
});

test("two writers of one normalized path are both refused, regardless of execution order", async () => {
	const f = fixture();
	f.message([edit, { id: "w", name: "write", arguments: { path: join(repo, "batch-a.ts"), content: "x" } }]);
	expect(await f.call("write", "w", { path: "batch-a.ts", content: "x" })).toMatchObject({ block: true });
	expect(await f.call("edit", "e", { path: "batch-a.ts", edits: [] })).toMatchObject({ block: true });
});

test.each([
	"grep -n fingerprint batch-a.ts",
	"npx vitest run ./batch-a.ts --maxWorkers=1",
	"./node_modules/.bin/biome check --write batch-a.ts",
	`cd '${repo}' && cat batch-a.ts`,
	"printf '%s' ';' cd other && cat batch-a.ts",
	'echo "a;b" | cat batch-a.ts',
])("a literal same-file shell consumer is refused: %s", async (command) => {
	const f = fixture();
	f.message([edit, { id: "b", name: "bash", arguments: { command } }]);
	expect(await f.call("bash", "b", { command })).toMatchObject({ block: true });
});

test.each([
	"cat batch-a.ts.bak",
	"cd other && cat batch-a.ts",
	"cat $FILE",
	"cat *.ts",
	"cat <<'EOF'\nbatch-a.ts\nEOF",
])("ambiguous shell or a different path is outside literal-path detection: %s", async (command) => {
	const f = fixture();
	f.message([edit, { id: "b", name: "bash", arguments: { command } }]);
	expect(await f.call("bash", "b", { command })).toBeUndefined();
});

test("quoted and escaped spaces in a literal path are normalized", async () => {
	for (const command of ["cat 'batch a.ts'", 'cat "batch a.ts"', "cat batch\\ a.ts"]) {
		const f = fixture();
		f.message([
			{ id: "w", name: "write", arguments: { path: "batch a.ts", content: "x" } },
			{ id: "b", name: "bash", arguments: { command } },
		]);
		expect(await f.call("bash", "b", { command })).toMatchObject({ block: true });
	}
});

test("a commit beside an edit is refused, and allowed in the next message", async () => {
	const f = fixture();
	f.message([edit, { id: "c", name: "bash", arguments: { command: "git commit -m x" } }]);
	expect((await f.call("bash", "c", { command: "git commit -m x" })).reason).toMatch(
		/\[commit-beside-edit\] This message also edits files/,
	);
	f.message([{ id: "c2", name: "bash", arguments: { command: "git commit -m x" } }]);
	expect(await f.call("bash", "c2", { command: "git commit -m x" })).toBeUndefined();
});

test("nested calls are left to the script's own ordering", async () => {
	const f = fixture();
	f.message([edit, { id: "r", name: "read", arguments: { path: "batch-a.ts" } }]);
	expect(await f.call("read", "r", { path: "batch-a.ts" }, "script")).toBeUndefined();
});

test.each([
	["a b.ts", "cat a' b'.ts"],
	["a'b.ts", String.raw`cat 'a'\''b.ts'`],
	[String.raw`a\b.ts`, String.raw`cat 'a\b.ts'`],
	[String.raw`a\b.ts`, String.raw`cat "a\b.ts"`],
	['a"b.ts', String.raw`cat "a\"b.ts"`],
	["a=b.ts", "cat 'a=b.ts'"],
	["-a.ts", "cat -- -a.ts"],
	[";", "cat ';'"],
	[";", String.raw`cat \;`],
	["batch-a.ts", "grep cd batch-a.ts"],
])("literal shell decoding preserves %s in %s", async (path, command) => {
	const f = fixture();
	f.message([
		{ id: "w", name: "write", arguments: { path, content: "x" } },
		{ id: "b", name: "bash", arguments: { command } },
	]);
	expect(await f.call("bash", "b", { command })).toMatchObject({ block: true });
});

test.each([
	["ab.ts", String.raw`cat 'a\b.ts'`],
	["b.ts", "cat a\u00a0b.ts"],
])("literal shell decoding keeps the independent file separate from %s", async (path, command) => {
	const f = fixture();
	f.message([
		{ id: "w", name: "write", arguments: { path, content: "x" } },
		{ id: "b", name: "bash", arguments: { command } },
	]);
	expect(await f.call("bash", "b", { command })).toBeUndefined();
});

test.each(["read", "write"])("a malformed sibling %s path is left to that call's own error", async (name) => {
	const f = fixture();
	f.message([
		edit,
		{ id: "bad", name, arguments: { path: "file://%" } },
		{ id: "r", name: "read", arguments: { path: "batch-b.ts" } },
		{ id: "b", name: "bash", arguments: { command: "true" } },
	]);
	expect(await f.call("read", "r", { path: "batch-b.ts" })).toBeUndefined();
	expect(await f.call("bash", "b", { command: "true" })).toBeUndefined();
});

test("without rules a parallel read of an edited file is not refused", async () => {
	const plain = mkdtempSync(join(tmpdir(), "batch-plain-"));
	try {
		const handler = fixture().handlers.get("tool_call")!;
		const content = [edit, { id: "r", name: "read", arguments: { path: "batch-a.ts" } }].map((call) => ({
			type: "toolCall",
			...call,
		}));
		const ctx = {
			cwd: plain,
			sessionManager: {
				getSessionId: () => "plain",
				buildSessionProjection: () => ({ messages: [{ role: "assistant", content }] }),
			},
		};
		expect(await handler({ toolName: "read", toolCallId: "r", input: { path: "batch-a.ts" } }, ctx)).toBeUndefined();
	} finally {
		rmSync(plain, { recursive: true, force: true });
	}
});

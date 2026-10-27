import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadRoles } from "../../organization/src/roles.js";
import * as roleState from "../../organization/src/session-role.js";
import { sendCommand } from "../../session-state/src/client.js";
import {
	fakeBridge,
	query,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../session-state/tests/helpers.js";
import install from "../src/index.js";

let state: ReturnType<typeof tempStateDir>;
let parent: ReturnType<typeof standInProcess>;
let bridge: Awaited<ReturnType<typeof fakeBridge>>;
let manager: SessionManager;
let tool: any;
let events: Map<string, Array<(...args: any[]) => any>>;
let ctx: any;
let invocation: number;
const lasting: string[] = [];
const fixture = new URL("../../../tests/fixtures/peer-pi.mjs", import.meta.url).pathname;

beforeEach(async () => {
	vi.spyOn(roleState, "sessionRole").mockReturnValue(loadRoles(process.cwd()).roles.get("coordinator"));
	state = tempStateDir();
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	await startRuntime(state.socketPath);
	manager = SessionManager.inMemory(state.agentDir);
	parent = standInProcess();
	bridge = await fakeBridge(state.socketPath, manager.getSessionId(), parent.pid, parent.startedAt, {
		session: { cwd: state.agentDir },
		facts: { manages: true },
	});
	await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions")).toHaveLength(1));
	events = new Map();
	install({
		appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
		registerTool(value: any) {
			if (value.name === "pi_exec") tool = value;
		},
		on(event: string, handler: (...args: any[]) => any) {
			const handlers = events.get(event) ?? [];
			handlers.push(handler);
			events.set(event, handlers);
		},
	} as any);
	ctx = { cwd: state.agentDir, sessionManager: manager, tools: [] };
	invocation = 0;
	for (const handler of events.get("before_agent_start") ?? [])
		await handler({ systemPromptOptions: { sections: {} } }, ctx);
});

afterEach(async () => {
	for (const handler of events?.get("session_shutdown") ?? []) await handler({}, ctx);
	for (const id of lasting.splice(0)) await sendCommand(id, { kind: "close" });
	bridge?.socket.destroy();
	parent?.child.kill();
	await stopRuntime(state);
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

function run(code: string, options: Record<string, unknown> = {}, signal?: AbortSignal) {
	return tool.execute(`run-${++invocation}`, { code, ...options }, signal, undefined, ctx);
}
function clean() {
	expect(query(state.dbPath, "select * from program_scopes")).toEqual([]);
	expect(query(state.dbPath, "select * from program_peers")).toEqual([]);
	expect(query(state.dbPath, "select id from sessions order by id")).toEqual(
		[manager.getSessionId(), ...lasting].sort().map((id) => ({ id })),
	);
}
function launches() {
	const dir = join(state.agentDir, "peer-records");
	return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(".launch.json")) : [];
}
async function colleague() {
	const id = randomUUID();
	const result = await sendCommand(id, {
		kind: "start",
		cwd: state.agentDir,
		reportsTo: manager.getSessionId(),
		role: "implementation-engineer",
		goal: { by: manager.getSessionId(), text: "Help check the work." },
	});
	expect(result.stage, result.reason).toBe("applied");
	lasting.push(id);
	return id;
}

test.each([undefined, "implementation-engineer"])(
	"a nonmanaging role or unrecorded caller cannot delegate; ordinary composition stays available (role=%s)",
	async (role) => {
		vi.mocked(roleState.sessionRole).mockReturnValue(role ? loadRoles(process.cwd()).roles.get(role) : undefined);
		if (!role) ctx = { ...ctx, sessionManager: SessionManager.inMemory(state.agentDir) };
		for (const handler of events.get("before_agent_start") ?? [])
			await handler({ systemPromptOptions: { sections: {} } }, ctx);
		expect(tool.parameters.properties).not.toHaveProperty("peers");
		expect(tool.parameters.properties.limits.properties).not.toHaveProperty("agentBudget");
		expect(tool.parameters.properties.code.description).not.toContain("async def peer(");
		expect(tool.parameters.properties.code.description).not.toContain("async def agent_run(");
		expect(tool.promptGuidelines.join("\n")).not.toContain("Attach awake colleagues");
		await expect(run('await agent(role="implementation-engineer", task="not allowed")')).rejects.toThrow(
			"managing role",
		);
		await expect(run('await peer("implementation-engineer")')).rejects.toThrow("managing role");
		await expect(run("1", { peers: { colleague: "someone" } })).rejects.toThrow("managing role");
		expect(JSON.parse((await run("1 + 2")).content[0].text)).toBe(3);
		expect(launches()).toEqual([]);
		clean();
	},
);

test("one-shot role peers return bound values and usage; their people and private task files disappear", async () => {
	const result = await run(`import asyncio
rows = await asyncio.gather(*[agent_run(role="implementation-engineer", task="Verify " + name, context={"value": name}, output_schema=schema({"value": "str"})) for name in ["a", "b", "c"]])
rows`);
	expect(JSON.parse(result.content[0].text).map((row: any) => row.value)).toEqual([
		{ value: "a" },
		{ value: "b" },
		{ value: "c" },
	]);
	expect(result.usage.totalTokens).toBe(30);
	expect(launches()).toHaveLength(3);
	clean();
	expect(query(state.dbPath, "select * from work_tasks")).toEqual([]);
	expect(readdirSync(join(state.stateDir, "tasks"))).toEqual([]);
	for (const operation of result.details.trace.operations)
		expect(operation.args.context).toMatchObject({ bound: true, chars: expect.any(Number) });
});

test("a reused peer runs in one session; explicit close invalidates the handle without spawning another", async () => {
	const result = await run(`p = await peer("implementation-engineer")
a = await p.run("First")
b = await p.run("Second")
await p.close()
try:
    await p.run("After close")
except Exception as error:
    failure = str(error)
[a, b, failure]`);
	expect(JSON.parse(result.content[0].text)).toEqual([
		"Reply from implementation-engineer: First",
		"Reply from implementation-engineer: Second",
		expect.stringContaining("closed"),
	]);
	expect(launches()).toHaveLength(1);
	clean();
});

test("named attachments preserve a lasting colleague and stale handles fail in the next execution", async () => {
	const id = await colleague();
	const first = await run('saved = peers["reviewer"]\nawait saved.run("First")', { peers: { reviewer: id } });
	expect(first.content[0].text).toBe("Reply from implementation-engineer: First");
	clean();
	for (const handler of events.get("session_tree") ?? []) await handler({}, ctx);
	await expect(run('await saved.run("Old")')).rejects.toThrow(/another pi_exec execution/);
	clean();
	const result = await run('await peers["reviewer"].run("Second")', { peers: { reviewer: id } });
	expect(result.content[0].text).toBe("Reply from implementation-engineer: Second");
	expect(launches()).toHaveLength(1);
	clean();
});

test("closing a peer can cancel its turn even when that turn occupies the only concurrency slot", async () => {
	const result = await run(
		`import asyncio
p = await peer("implementation-engineer")
async def wait_for_result():
    try:
        return await p.run("hold the result")
    except Exception:
        return "cancelled"
async def close_peer():
    await asyncio.sleep(0.05)
    await p.close()
    return "closed"
await asyncio.gather(wait_for_result(), close_peer())`,
		{ limits: { concurrency: 1, timeoutSeconds: 1 } },
	);
	expect(JSON.parse(result.content[0].text)).toEqual(["cancelled", "closed"]);
	clean();
});

test("failure and a model-turn budget limit both clean open handles", async () => {
	await expect(
		run('p = await peer("implementation-engineer")\nawait p.run("First")\nraise ValueError("broken calculation")'),
	).rejects.toThrow(/broken calculation/);
	clean();
	await expect(
		run('q = await peer("implementation-engineer")\nawait q.run("First")\nawait q.run("Second")', {
			limits: { agentBudget: 1 },
		}),
	).rejects.toThrow(/agent budget exhausted/);
	clean();
	expect(launches()).toHaveLength(2);
});

test.each(["attached", "temporary"])(
	"program cancellation retains partial usage and respects the %s person's lifetime",
	async (kind) => {
		const id = kind === "attached" ? await colleague() : undefined;
		const controller = new AbortController();
		const pending = run(
			id
				? 'await peers["reviewer"].run("hold the result")'
				: 'await agent(role="implementation-engineer", task="hold the result")',
			id ? { peers: { reviewer: id } } : {},
			controller.signal,
		);
		const rejected = expect(pending).rejects.toThrow(/aborted/);
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select 1 from commands where kind = 'run_turn' and stage = 'delivered'"),
			).toHaveLength(1),
		);
		controller.abort();
		await rejected;
		const failure = events
			.get("tool_result")!
			.map((handler) => handler({ toolName: "pi_exec", isError: true, toolCallId: "run-1" }))
			.find(Boolean);
		expect(failure.usage.totalTokens).toBe(10);
		clean();
		const launch = JSON.parse(readFileSync(join(state.agentDir, "peer-records", launches()[0]), "utf8"));
		if (id) expect(() => process.kill(launch.pid, 0)).not.toThrow();
		else expect(() => process.kill(launch.pid, 0)).toThrow();
	},
);

test("an ordinary calculation and an unused role handle launch no peer or program scope", async () => {
	const result = await run('unused = await peer("implementation-engineer")\n2 + 3');
	expect(result.content[0].text).toBe("5");
	expect(launches()).toEqual([]);
	clean();
});

test("bound context keeps its fitting rules, private file permissions, and large unmarked values", async () => {
	const result = await run(
		`context = {"value": await context_clippable(value="abcdef", max_chars=3)}
row = await agent_run(role="implementation-engineer", task="Fit", context=context, output_schema=schema({"value": "str"}))
large = await agent(role="implementation-engineer", task="Read", context={"value": inputs["large"]}, output_schema=schema({"value": "str"}))
[row, len(large["value"])]`,
		{ inputs: { large: "x".repeat(75_000) } },
	);
	const values = JSON.parse(result.content[0].text);
	expect(values[0]).toMatchObject({ value: { value: "abc" }, context: { truncated: ["$.value"], dropped: [] } });
	expect(values[1]).toBe(75_000);
	const records = join(state.agentDir, "peer-records");
	for (const file of readdirSync(records).filter((name) => name.endsWith(".commands.jsonl"))) {
		const command = readFileSync(join(records, file), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line))
			.find((entry) => entry.command.contextFile);
		expect(command.contextMode).toBe(0o600);
	}
	expect(JSON.stringify(result.details.trace.operations[0])).not.toContain("abcdef");
	clean();
});

test("a failed peer is a local status record with partial text and usage", async () => {
	const result = await run(`import asyncio
await asyncio.gather(*[agent_run(role="implementation-engineer", task=t) for t in ["First", "fail", "Last"]])`);
	const values = JSON.parse(result.content[0].text);
	expect(values.map((value: any) => value.status)).toEqual(["completed", "failed", "completed"]);
	expect(values[1]).toMatchObject({ text: "Partial reply", error: "The peer failed" });
	expect(result.usage.totalTokens).toBe(30);
	expect(result.details.trace.operations[1].outcome).toBe("failed");
	clean();
});

test("functions saved in an earlier feed use this execution's model-turn budget", async () => {
	await run('async def ask():\n    return await agent_run(role="implementation-engineer", task="Check")');
	const result = await run("a = await ask()\nb = await ask()\n[a, b]", { limits: { agentBudget: 1 } });
	const values = JSON.parse(result.content[0].text);
	expect(values[0].status).toBe("completed");
	expect(values[1]).toMatchObject({ status: "failed", error: expect.stringContaining("agent budget exhausted") });
	expect(launches()).toHaveLength(1);
	clean();
});

test("a program refuses to attach its own session instead of waiting on itself", async () => {
	await expect(run('await peers["me"].run("Wait")', { peers: { me: manager.getSessionId() } })).rejects.toThrow(
		/own session/,
	);
	clean();
});

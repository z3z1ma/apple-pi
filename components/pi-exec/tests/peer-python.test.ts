import { afterEach, expect, test } from "vitest";
import { guestPythonStubs, piExecGuestApiContract } from "../src/guest-api.js";
import { createProgramSession, executeProgram } from "../src/program.js";
import type { ProgramHostCall } from "../src/types.js";

const sessions: Array<Awaited<ReturnType<typeof createProgramSession>>> = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
});
const stubs = () => guestPythonStubs(process.cwd(), []);
async function open(dump?: Uint8Array) {
	const live = await createProgramSession(stubs(), dump);
	sessions.push(live);
	return live;
}
const calls: Array<{ ref: string; args: Record<string, unknown> }> = [];
const host: ProgramHostCall = async (ref, args) => {
	calls.push({ ref, args });
	if (ref === "peer.open") return "fresh-handle";
	if (ref === "peer.close") return null;
	return {
		status: "completed",
		text: `reply:${args.task}`,
		...(args.outputSchema ? { value: { verified: true } } : {}),
	};
};
afterEach(() => {
	calls.length = 0;
});

test("a role handle runs twice, returns prose or a structured value, and closes", async () => {
	const { session } = await open();
	const result = await executeProgram(
		session,
		`p = await peer("code-review-specialist")
a = await p.run("Inspect the change")
b = await p.run("Confirm it", output_schema=schema({"verified": "bool"}))
await p.close()
[a, b]`,
		{},
		10_000,
		host,
	);
	expect(result).toMatchObject({ outcome: "succeeded", value: ["reply:Inspect the change", { verified: true }] });
	expect(calls.map((call) => call.ref)).toEqual(["peer.open", "peer.run", "peer.run", "peer.close"]);
	expect(calls[1]?.args).toMatchObject({ key: "fresh-handle", task: "Inspect the change" });
});

test("named attachments refresh each execution; saved handles use the current host after checkpoint restore", async () => {
	const first = await open();
	const saved = await executeProgram(
		first.session,
		'saved = peers["reviewer"]\nawait saved.run("First")',
		{},
		10_000,
		host,
		undefined,
		undefined,
		undefined,
		[],
		{ reviewer: "first-execution" },
	);
	expect(saved).toMatchObject({ outcome: "succeeded", value: "reply:First" });
	const restored = await open(await first.session.dump());
	const seen: string[] = [];
	const result = await executeProgram(
		restored.session,
		'fresh = await peers["reviewer"].run("Second")\nold = await saved.run("Old")\n[fresh, old]',
		{},
		10_000,
		async (_ref, args) => {
			seen.push(String(args.key));
			return { status: "completed", text: "current host" };
		},
		undefined,
		undefined,
		undefined,
		[],
		{ reviewer: "second-execution" },
	);
	expect(result).toMatchObject({ outcome: "succeeded", value: ["current host", "current host"] });
	expect(seen).toEqual(["second-execution", "first-execution"]);
});

test("role-based one-shot calls retain their status and value forms", async () => {
	const { session } = await open();
	const result = await executeProgram(
		session,
		`row = await agent_run(role="implementation-engineer", task="Check")
value = await agent(role="implementation-engineer", task="Check", output_schema=schema({"verified": "bool"}))
[row["text"], value]`,
		{},
		10_000,
		host,
	);
	expect(result).toMatchObject({ outcome: "succeeded", value: ["reply:Check", { verified: true }] });
});

test("role-owned inference rejects profile and tool overrides before a host call", async () => {
	const { session } = await open();
	const result = await executeProgram(
		session,
		'await agent(role="implementation-engineer", task="Check", profile="quick")',
		{},
		10_000,
		host,
	);
	expect(result).toMatchObject({ outcome: "failed", error: expect.stringContaining("profile") });
	expect(calls).toEqual([]);
});

test("the model sees the peer facade, lifetime rules and role ownership rather than its transport keys", () => {
	const contract = piExecGuestApiContract();
	expect(contract).toContain("class Peer:");
	expect(contract).toContain("role: str");
	expect(contract).not.toContain("peer_open");
	expect(contract).not.toContain("profile: str");
});

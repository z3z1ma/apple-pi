import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { close, fakeBridge, query, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const log = join(state.agentDir, "launch.json");
const body = "Verified: the code map is current. Open: queue retries. See docs/code-map.md.";
beforeAll(async () => {
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	writeFileSync(
		join(bin, "pi"),
		`#!${process.execPath}
import { appendFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const id = flag("--session-id");
writeFileSync(process.env.WORKPLACE_PI_LOG, JSON.stringify(args));
writeFileSync(process.env.WORKPLACE_PI_LOG + '.pid', String(process.pid));
const socket = createConnection(process.env.PI_CODING_AGENT_DIR + "/state/apple-pi.sock");
const send = (message) => socket.write(JSON.stringify(message) + "\\n");
socket.on("connect", () => send({ type: "hello", session: { id, kind: "root", cwd: process.cwd(), name: flag("--name") },
	process: { pid: process.pid, startedAt: Math.floor(Date.now() - process.uptime() * 1000) }, run: "idle",
	facts: { role: flag("--role"), reportsTo: flag("--reports-to") } }));
let buffer = "";
socket.on("data", (chunk) => {
	buffer += chunk.toString();
	for (let end = buffer.indexOf("\\n"); end >= 0; end = buffer.indexOf("\\n")) {
		const message = JSON.parse(buffer.slice(0, end));
		buffer = buffer.slice(end + 1);
		if (message.type !== "command") continue;
		appendFileSync(process.env.WORKPLACE_PI_LOG + ".commands", JSON.stringify(message.command) + "\\n");
		if (message.command.kind === "run_turn") send({ type: "command_progress", commandId: message.commandId, stage: "applied",
			result: { status: "completed", text: process.env.WORKPLACE_HANDOVER, operations: [], changes: [] } });
		if (message.command.kind === "close") socket.end(JSON.stringify({ type: "shutdown", reason: "quit" }) + "\\n");
	}
});
socket.on("close", () => process.exit(0));
`,
	);
	chmodSync(join(bin, "pi"), 0o755);
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	vi.stubEnv("WORKPLACE_PI_LOG", log);
	vi.stubEnv("WORKPLACE_HANDOVER", body);
	await startRuntime(state.socketPath);
});
afterAll(() => stopRuntime(state));

test("letting an asleep person go wakes its existing identity only for its handover, then closes it", async () => {
	const id = "sleeping-colleague";
	const manager = await fauxSession(
		[bridge],
		[
			fauxAssistantMessage([fauxToolCall("let_go", { person: id, reason: "The investigation is complete." })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Noted."),
		],
		[],
	);
	manager.session.extensionRunner.setFlagValue("role", "coordinator");
	await manager.session.bindExtensions({});
	const managerId = manager.session.sessionManager.getSessionId();
	const stand = standInProcess();
	const prior = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
		session: { cwd: state.agentDir, name: "Edda" },
		facts: {
			reportsTo: managerId,
			role: "repository-archaeologist",
			title: "Repository Archaeologist",
			manages: false,
		},
	});
	try {
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select role from sessions where id = ?", id)).toEqual([
				{ role: "repository-archaeologist" },
			]),
		);
		prior.send({ type: "shutdown", reason: "quit" });
		prior.socket.end();
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select 1 from incarnations where session_id = ? and ended_at is not null", id),
			).toHaveLength(1),
		);
		stand.child.kill();
		await manager.session.prompt("Let the colleague go.");
		expect(manager.session.messages.filter((message) => message.role === "toolResult").at(-1)).toMatchObject({
			isError: false,
		});
		await vi.waitFor(
			() =>
				expect(query(state.dbPath, "select stage from commands where session_id = ? and kind = 'retire'", id)).toEqual([
					{ stage: "applied" },
				]),
			{ timeout: 10000 },
		);
		expect(JSON.parse(readFileSync(log, "utf8"))).toEqual([
			"--mode",
			"rpc",
			"--session-id",
			id,
			"--name",
			"Edda",
			"--reports-to",
			managerId,
			"--role",
			"repository-archaeologist",
		]);
		const [{ data }] = query<{ data: string }>(
			state.dbPath,
			"select data from events where type = 'person_departed' and session_id = ?",
			id,
		);
		const departure = JSON.parse(data);
		expect(departure).toMatchObject({ role: "repository-archaeologist", reason: "The investigation is complete." });
		expect(readFileSync(departure.handoffFile, "utf8")).toContain(body);
		expect(query(state.dbPath, "select 1 from sessions where id = ?", id)).toHaveLength(0);
		expect(query(state.dbPath, "select 1 from incarnations where session_id = ?", id)).toHaveLength(0);
		expect(
			query(
				state.dbPath,
				"select body from thread_messages where thread_id = ? and sender = ?",
				`team:${managerId}`,
				id,
			),
		).toHaveLength(0);
		const pid = Number(readFileSync(`${log}.pid`, "utf8"));
		expect(() => process.kill(pid, 0)).toThrow();
		const commands = readFileSync(`${log}.commands`, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(commands.map((command) => command.kind)).toEqual(["run_turn", "close"]);
		expect(commands[0].task).toContain("final handoff");
	} finally {
		prior.socket.destroy();
		stand.child.kill();
		await manager.session.abort();
		await close(manager);
	}
}, 15000);

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";

const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const id = argument("--session-id");
const role = argument("--role");
const parent = argument("--reports-to");
const agentDir = process.env.PI_CODING_AGENT_DIR;
const stateDir = join(agentDir, "state");
const controlPath = join(agentDir, "peer-control.json");
const control = existsSync(controlPath) ? JSON.parse(readFileSync(controlPath, "utf8")) : {};
const records = join(agentDir, "peer-records");
mkdirSync(records, { recursive: true });
const file = join(records, `${id}.jsonl`);
writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: process.cwd() })}\n`);
writeFileSync(
	join(records, `${id}.launch.json`),
	JSON.stringify({
		args: process.argv.slice(2),
		pid: process.pid,
		program: process.env.PI_PROGRAM_ID,
		parent: process.env.PI_PROGRAM_PARENT,
	}),
);
let socket;
let stopping = false;
const controlledRuns = new Map();
const send = (message) => {
	if (socket?.writable) socket.write(`${JSON.stringify(message)}\n`);
};
const finishStop = () => {
	writeFileSync(join(records, `${id}.stopped`), "graceful shutdown");
	send({ type: "shutdown", reason: "quit" });
	setTimeout(() => process.exit(0), control.exitDelay ?? 0);
};
const stop = () => {
	if (stopping) return;
	stopping = true;
	for (const run of controlledRuns.values()) run.abort();
	if (controlledRuns.size === 0) finishStop();
};
process.on("SIGTERM", stop);
process.on("SIGHUP", stop);
if (process.argv.includes("rpc")) {
	process.stdin.resume();
	process.stdin.on("end", stop);
}
if (control.failStartup) process.exit(1);
while (control.helloGate && !existsSync(control.helloGate)) await new Promise((resolve) => setTimeout(resolve, 20));
if (!stopping) {
	socket = createConnection(join(stateDir, "apple-pi.sock"));
	socket.on("error", stop);
	socket.on("close", stop);
	socket.once("connect", () =>
		send({
			type: "hello",
			session: {
				id,
				kind: "root",
				cwd: process.cwd(),
				name: `Fixture ${id}`,
				file,
				...(process.env.PI_PROGRAM_ID
					? { program: { id: process.env.PI_PROGRAM_ID, parent: process.env.PI_PROGRAM_PARENT } }
					: {}),
			},
			process: { pid: process.pid, startedAt: Math.round(Date.now() - process.uptime() * 1000) },
			...(process.env.TMUX && process.env.TMUX_PANE
				? { tmux: { socket: process.env.TMUX.split(",")[0], pane: process.env.TMUX_PANE } }
				: {}),
			run: "idle",
			facts: {
				reportsTo: parent,
				role,
				manages: role === "team-lead",
				model: `fixture/${role}`,
				thinkingLevel: "high",
			},
		}),
	);
	const held = new Map();
	const result = (commandId, value) => {
		send({ type: "run", run: "idle" });
		send({
			type: "command_progress",
			commandId,
			stage: value.status === "completed" ? "applied" : "failed",
			result: {
				...value,
				usage: {
					input: 4,
					output: 6,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 10,
					cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
				},
			},
		});
	};
	const controlledTurn = async (commandId, command) => {
		const plan = JSON.parse(command.task);
		const controller = new AbortController();
		controlledRuns.set(commandId, controller);
		const tools = plan.tools ?? [plan];
		const children = tools.map((tool, sequence) => ({
			sequence,
			ref: `pi.${tool.tool}`,
			args: tool.args ?? {},
			status: "running",
			outcome: "aborted",
			startedAt: Date.now(),
		}));
		const progress = () => send({ type: "turn_progress", commandId, progress: { activity: "using tools", children } });
		progress();
		try {
			await Promise.all(
				tools.map(async (tool, index) => {
					const call = children[index];
					try {
						const body = await (
							await fetch(tool.gate, { signal: plan.holdTerm ? undefined : controller.signal })
						).text();
						call.result = body;
						call.status = call.outcome = body.startsWith("error:") ? "failed" : "succeeded";
						if (call.outcome === "failed") call.error = body;
					} catch (error) {
						call.status = call.outcome = controller.signal.aborted ? "aborted" : "failed";
						call.error = String(error);
					}
					call.finishedAt = Date.now();
					progress();
				}),
			);
			let value;
			if (command.outputSchema && !controller.signal.aborted) {
				const context = command.contextFile ? JSON.parse(readFileSync(command.contextFile, "utf8")) : {};
				value = Object.fromEntries(Object.keys(command.outputSchema.properties).map((name) => [name, context[name]]));
				children.push({
					sequence: children.length,
					ref: "pi_exec_return",
					args: value,
					status: "succeeded",
					outcome: "succeeded",
					startedAt: Date.now(),
					finishedAt: Date.now(),
				});
				progress();
			}
			result(commandId, {
				status: controller.signal.aborted ? "failed" : "completed",
				text: `done:${children.map((call) => call.result ?? "").join(" / ")}`,
				...(controller.signal.aborted ? { error: "Run aborted" } : {}),
				...(value ? { value } : {}),
				operations: children.map(({ status, startedAt, finishedAt, ...call }) => call),
				changes: [],
			});
		} finally {
			controlledRuns.delete(commandId);
			if (stopping && controlledRuns.size === 0) finishStop();
		}
	};
	let buffer = "";
	socket.on("data", (chunk) => {
		buffer += chunk;
		for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
			const message = JSON.parse(buffer.slice(0, end));
			buffer = buffer.slice(end + 1);
			if (message.type !== "command") continue;
			const { commandId, command } = message;
			appendFileSync(
				join(records, `${id}.commands.jsonl`),
				`${JSON.stringify({
					...message,
					...(command.contextFile ? { contextMode: statSync(command.contextFile).mode & 0o777 } : {}),
				})}\n`,
			);
			if (command.kind === "run_turn") {
				send({ type: "run", run: "thinking" });
				send({ type: "command_progress", commandId, stage: "delivered" });
				appendFileSync(
					file,
					`${JSON.stringify({ type: "message", message: { role: "user", content: command.task } })}\n`,
				);
				if (command.task.startsWith("{")) {
					void controlledTurn(commandId, command);
					continue;
				}
				if (command.task.startsWith("hold")) {
					held.set(commandId, command);
					continue;
				}
				if (command.task === "fail") {
					result(commandId, {
						status: "failed",
						text: "Partial reply",
						error: "The peer failed",
						operations: [],
						changes: [],
					});
					continue;
				}
				const text = `Reply from ${role}: ${command.task}`;
				appendFileSync(
					file,
					`${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } })}\n`,
				);
				result(commandId, {
					status: "completed",
					text,
					...(command.outputSchema
						? {
								value: command.contextFile
									? JSON.parse(readFileSync(command.contextFile, "utf8"))
									: { value: command.task },
							}
						: {}),
					operations: [],
					changes: [],
				});
			} else if (command.kind === "cancel_turn") {
				controlledRuns.get(command.turn)?.abort();
				if (held.delete(command.turn))
					result(command.turn, { status: "failed", text: "", error: "Run aborted", operations: [], changes: [] });
				send({ type: "command_progress", commandId, stage: "applied" });
			} else if (command.kind === "close") stop();
			else send({ type: "command_progress", commandId, stage: "applied" });
		}
	});
}

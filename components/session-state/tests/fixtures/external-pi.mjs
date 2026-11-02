import { appendFileSync } from "node:fs";
import { createConnection } from "node:net";

const args = process.argv.slice(2);
const id = args[args.indexOf("--session-id") + 1];
appendFileSync(process.env.EXTERNAL_LAUNCHES, `${id}\n`);
const socket = createConnection(`${process.env.PI_CODING_AGENT_DIR}/state/apple-pi.sock`);
const send = (message) => socket.write(`${JSON.stringify(message)}\n`);
socket.on("connect", () =>
	send({
		type: "hello",
		session: { id, kind: "root", cwd: process.cwd() },
		process: { pid: process.pid, startedAt: Math.floor(Date.now() - process.uptime() * 1000) },
		run: "idle",
		facts: {},
	}),
);
let buffer = "";
socket.on("data", (chunk) => {
	buffer += chunk.toString();
	for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
		const message = JSON.parse(buffer.slice(0, end));
		buffer = buffer.slice(end + 1);
		if (message.command?.kind === "mail") {
			appendFileSync(process.env.EXTERNAL_MAIL, `${JSON.stringify(message.command)}\n`);
			send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
		}
	}
});
socket.on("close", () => process.exit(0));

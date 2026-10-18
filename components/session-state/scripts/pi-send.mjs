#!/usr/bin/env node
// Mail a Pi session: pi-send <session-id> [--from <name>] [message]
// Without a message argument, the message is read from stdin. Starts the session-state runtime when none runs,
// prints the mail id, and says on stderr when the session is not running and the mail waits.
import { readFileSync } from "node:fs";
import "../src/register.mjs";

const { sendCommand } = await import("../src/client.ts");

const args = process.argv.slice(2);
let from = "shell";
const fromIndex = args.indexOf("--from");
if (fromIndex !== -1) {
	from = args[fromIndex + 1] ?? "";
	args.splice(fromIndex, 2);
}
const [sessionId, ...words] = args;
if (!sessionId || !from) {
	console.error("usage: pi-send <session-id> [--from <name>] [message]");
	process.exit(2);
}
const body = words.length > 0 ? words.join(" ") : readFileSync(0, "utf8").replace(/\n$/, "");
if (!body) {
	console.error("pi-send: empty message");
	process.exit(2);
}

const receipt = await sendCommand(sessionId, { kind: "mail", from, body, sentAt: new Date().toISOString() });
if (receipt.stage === "failed") {
	console.error(`pi-send: ${receipt.reason}`);
	process.exit(1);
}
console.log(receipt.commandId);
if (receipt.reason) console.error(`pi-send: the session is ${receipt.reason}`);

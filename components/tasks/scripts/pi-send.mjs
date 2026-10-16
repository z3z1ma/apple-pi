#!/usr/bin/env node
// Append one message to a Pi session's mailbox: pi-send <session-id> [--from <name>] [message]
// Without a message argument, the message is read from stdin. The format matches
// components/tasks/src/mailbox.ts, which reads it.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
let from = "shell";
const fromIndex = args.indexOf("--from");
if (fromIndex !== -1) {
	from = args[fromIndex + 1] ?? "";
	args.splice(fromIndex, 2);
}
const [sessionId, ...words] = args;

if (!sessionId || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(sessionId) || !from) {
	console.error("usage: pi-send <session-id> [--from <name>] [message]");
	process.exit(2);
}

const body = words.length > 0 ? words.join(" ") : readFileSync(0, "utf8").replace(/\n$/, "");
if (!body) {
	console.error("pi-send: empty message");
	process.exit(2);
}
const dir =
	process.env.PI_MAILBOX_DIR ||
	join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "state", "mailbox");
const message = { id: randomUUID(), from, ts: new Date().toISOString(), body };
mkdirSync(dir, { recursive: true });
appendFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(message)}\n`);
console.log(message.id);

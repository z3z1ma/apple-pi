import type { Socket } from "node:net";
import type { ReplyDelta, ReplyEnd } from "./protocol.js";

export interface ReplySubscriber {
	socket: Socket;
	subscriptions?: Set<string>;
	held?: Map<string, { end?: ReplyEnd; delta?: ReplyDelta }>;
}

export function relayReply(clients: Iterable<ReplySubscriber>, message: ReplyDelta | ReplyEnd): void {
	for (const client of clients) {
		if (!client.subscriptions?.has(message.sessionId)) continue;
		if (!client.held && !client.socket.writableNeedDrain) {
			client.socket.write(`${JSON.stringify(message)}\n`);
			continue;
		}
		if (!client.held) {
			client.held = new Map();
			client.socket.once("drain", () => flushHeld(client));
		}
		const held = client.held.get(message.sessionId) ?? {};
		client.held.set(message.sessionId, held);
		if (message.type === "reply_end") {
			held.end = message;
			if (held.delta && held.delta.streamId !== message.streamId) held.delta = undefined;
		} else if (held.delta?.streamId === message.streamId)
			held.delta = { ...held.delta, seq: message.seq, delta: held.delta.delta + message.delta };
		else held.delta = message;
	}
}

function flushHeld(client: ReplySubscriber): void {
	const held = client.held;
	client.held = undefined;
	if (!held || client.socket.destroyed) return;
	const write = (message: ReplyDelta | ReplyEnd | undefined) =>
		message && client.socket.write(`${JSON.stringify(message)}\n`);
	for (const { end, delta } of held.values()) {
		if (end && delta?.streamId === end.streamId) {
			write(delta);
			write(end);
		} else {
			write(end);
			write(delta);
		}
	}
}

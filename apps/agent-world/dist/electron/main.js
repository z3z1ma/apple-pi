import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWindow, app, ipcMain, net, protocol, shell } from "electron";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
//#region components/session-state/src/paths.ts
/** Pi's own rule for `PI_CODING_AGENT_DIR`: a leading `~` means the home directory. */
function agentDir() {
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (!configured) return join(homedir(), ".pi", "agent");
	if (configured === "~") return homedir();
	if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
	return resolve(configured);
}
/** Where the runtime keeps its files; read at call time so tests can redirect it. */
function statePaths() {
	const dir = join(agentDir(), "state");
	return {
		dir,
		db: join(dir, "apple-pi.db"),
		socket: join(dir, "apple-pi.sock"),
		lock: join(dir, "apple-pi-runtime.lock"),
		pid: join(dir, "apple-pi-runtime.pid"),
		log: join(dir, "apple-pi-runtime.log")
	};
}
//#endregion
//#region apps/agent-world/src/app-files.ts
/**
* The file for a URL path: `/themes/...` from the theme packs, anything else from the built UI. Undefined for a
* path that would leave those directories.
*/
function appFile(appDir, pathname) {
	const path = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
	if (path.split(sep).includes("..")) return void 0;
	if (path.startsWith(`themes${sep}`)) return join(appDir, path);
	return join(appDir, "dist", "web", path || "index.html");
}
//#endregion
//#region apps/agent-world/src/backend/commands.ts
/** The runtime answers `accepted` at once; without it this soon, it is not answering. */
var ACCEPT_TIMEOUT_MS = 5e3;
var GONE$1 = "The session runtime is not answering.";
var LOST = "The session runtime went away before the command finished; it may still have been applied.";
function openCommands(socketPath) {
	let socket;
	let connecting;
	let closed = false;
	const waiting = /* @__PURE__ */ new Map();
	const connect = () => {
		if (socket && !socket.destroyed) return Promise.resolve(socket);
		connecting ??= new Promise((resolve, reject) => {
			const next = createConnection(socketPath);
			let buffer = "";
			next.on("data", (chunk) => {
				buffer += chunk.toString();
				for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
					const line = buffer.slice(0, end);
					buffer = buffer.slice(end + 1);
					let reply;
					try {
						reply = JSON.parse(line);
					} catch {
						continue;
					}
					if (reply.type !== "receipt" || typeof reply.commandId !== "string") continue;
					const handler = waiting.get(reply.commandId);
					if (!handler) continue;
					const stage = reply.stage;
					const reason = typeof reply.reason === "string" ? reply.reason : void 0;
					if (stage === "accepted") handler.accepted = true;
					handler.onReceipt(stage, stage === "failed" ? reason ?? "failed" : reason);
					if (stage === "applied") handler.settle({ ok: true });
					else if (stage === "failed") handler.settle({
						ok: false,
						reason: reason ?? "failed"
					});
				}
			});
			next.once("connect", () => {
				socket = next;
				connecting = void 0;
				resolve(next);
			});
			next.on("error", (error) => {
				if (socket !== next) {
					connecting = void 0;
					reject(error);
				}
			});
			next.on("close", () => {
				if (socket === next) socket = void 0;
				for (const handler of [...waiting.values()]) handler.settle({
					ok: false,
					reason: handler.accepted ? LOST : GONE$1
				});
			});
		});
		return connecting;
	};
	return {
		async send(sessionId, command, options = {}) {
			if (closed) return {
				ok: false,
				reason: GONE$1
			};
			let open;
			try {
				open = await connect();
			} catch {
				return {
					ok: false,
					reason: GONE$1
				};
			}
			const commandId = options.commandId ?? `agent-world-${randomUUID()}`;
			return new Promise((resolve) => {
				const timer = setTimeout(() => {
					if (!handler.accepted) handler.settle({
						ok: false,
						reason: GONE$1
					});
				}, ACCEPT_TIMEOUT_MS);
				const handler = {
					accepted: false,
					onReceipt: (stage, reason) => options.onReceipt?.(stage, reason),
					settle(result) {
						if (waiting.get(commandId) !== handler) return;
						waiting.delete(commandId);
						clearTimeout(timer);
						resolve(result);
					}
				};
				waiting.set(commandId, handler);
				open.write(`${JSON.stringify({
					type: "command",
					commandId,
					sessionId,
					command
				})}\n`);
			});
		},
		close() {
			closed = true;
			socket?.destroy();
		}
	};
}
//#endregion
//#region apps/agent-world/src/world.ts
/** The places outside any headquarters. */
var OUTSIDE_KINDS = [
	"square",
	"street",
	"inn",
	"rookery",
	"forge",
	"quest-office",
	"library"
];
/** The label mail from the operator carries as its sender (`from`), so agents can tell it from mail between them. */
var OPERATOR = "operator";
var MAIL_BODY_MAX = 4e3;
/** A place outside any headquarters: the square, or a place off it. */
function isOutside(place) {
	return OUTSIDE_KINDS.includes(place.kind);
}
/** Longest text of one transcript field sent to the world UI. */
var TRANSCRIPT_TEXT_MAX = 2e4;
//#endregion
//#region apps/agent-world/src/backend/transcript.ts
/** The custom message type of delivered mail (`components/session-state/src/mail.ts`). */
var MAIL$1 = "apple-pi.mailbox-message";
/** The argument a tool call is known by, in the bridge's order (`components/session-state/src/bridge.ts`). */
var MAIN_ARGS = [
	"command",
	"path",
	"pattern",
	"query",
	"description",
	"task",
	"name",
	"code"
];
function mainArg(args) {
	if (!args || typeof args !== "object") return null;
	for (const key of MAIN_ARGS) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) return value.trim().split("\n")[0];
	}
	return null;
}
function cut(text) {
	return text.length > 2e4 ? {
		text: text.slice(0, TRANSCRIPT_TEXT_MAX),
		cut: true
	} : {
		text,
		cut: false
	};
}
var clip = (text) => cut(text).text;
/** The text of a message's content (a string, or text and image parts), and how many images it holds. */
function contentOf(content) {
	if (typeof content === "string") return {
		text: content,
		images: 0
	};
	const texts = [];
	let images = 0;
	for (const part of Array.isArray(content) ? content : []) if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
	else if (part?.type === "image") images++;
	return {
		text: texts.join("\n"),
		images
	};
}
/** The mail's body: from its details, else the text inside the `<mailbox-message>` wrapper. */
function mailOf(entry) {
	const details = entry.details;
	const raw = contentOf(entry.content).text;
	return {
		from: typeof details?.from === "string" ? details.from : /from="([^"]*)"/.exec(raw)?.[1] ?? "someone",
		text: clip(typeof details?.body === "string" ? details.body : raw.replace(/^\s*<mailbox-message[^>]*>\n?/, "").replace(/\n?<\/mailbox-message>\s*$/, ""))
	};
}
function partsOf(content) {
	const parts = [];
	for (const part of Array.isArray(content) ? content : []) if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) parts.push({
		kind: "text",
		text: clip(part.text)
	});
	else if (part?.type === "thinking" && typeof part.thinking === "string" && (part.thinking.trim() || part.redacted)) parts.push({
		kind: "thinking",
		text: part.redacted ? "" : clip(part.thinking)
	});
	else if (part?.type === "toolCall" && typeof part.name === "string") parts.push({
		kind: "tool",
		call: {
			id: String(part.id ?? ""),
			name: part.name,
			arg: mainArg(part.arguments),
			input: clip(JSON.stringify(part.arguments ?? {}, null, 2))
		}
	});
	return parts;
}
/** One transcript entry for the panel; undefined for entries it does not show. */
function transcriptEntry(raw) {
	if (!raw || typeof raw !== "object") return void 0;
	const entry = raw;
	const id = String(entry.id ?? "");
	const at = Date.parse(String(entry.timestamp ?? "")) || 0;
	if (entry.type === "custom_message") {
		const label = String(entry.customType ?? "message");
		if (label === MAIL$1) return {
			kind: "mail",
			id,
			at,
			...mailOf(entry)
		};
		return {
			kind: "note",
			id,
			at,
			label,
			text: clip(contentOf(entry.content).text),
			shown: entry.display !== false
		};
	}
	if (entry.type !== "message") return void 0;
	const message = entry.message;
	if (message?.role === "user") {
		const { text, images } = contentOf(message.content);
		return {
			kind: "user",
			id,
			at,
			text: clip(text),
			images
		};
	}
	if (message?.role === "assistant") return {
		kind: "assistant",
		id,
		at,
		parts: partsOf(message.content),
		error: message.stopReason === "error" ? String(message.errorMessage ?? "The reply failed.") : null,
		aborted: message.stopReason === "aborted"
	};
	if (message?.role === "toolResult") {
		const { text, images } = contentOf(message.content);
		const shown = cut(images ? `${text}${text ? "\n" : ""}${images === 1 ? "[an image]" : `[${images} images]`}` : text);
		return {
			kind: "tool-result",
			id,
			at,
			callId: String(message.toolCallId ?? ""),
			tool: String(message.toolName ?? "tool"),
			text: shown.text,
			isError: message.isError === true,
			cut: shown.cut
		};
	}
}
/** A page of a long transcript can take a while to read; a command is answered at once. */
var PAGE_TIMEOUT_MS = 2e4;
var COMMAND_TIMEOUT_MS = 5e3;
var GONE = "The session runtime is not answering.";
/** How long a subscription waits for the runtime to confirm it, and how soon a lost one is made again. */
var SUBSCRIBE_TIMEOUT_MS = 3e3;
var RESUBSCRIBE_MS = 1e3;
function openConversations(socketPath) {
	let socket;
	let connecting;
	let closed = false;
	const waiting = /* @__PURE__ */ new Map();
	const connect = () => {
		if (socket && !socket.destroyed) return Promise.resolve(socket);
		connecting ??= new Promise((resolve, reject) => {
			const next = createConnection(socketPath);
			let buffer = "";
			next.on("data", (chunk) => {
				buffer += chunk.toString();
				for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
					const line = buffer.slice(0, end);
					buffer = buffer.slice(end + 1);
					let reply;
					try {
						reply = JSON.parse(line);
					} catch {
						continue;
					}
					const key = String(reply.requestId ?? reply.commandId ?? "");
					if (waiting.get(key)?.onReply(reply)) waiting.delete(key);
				}
			});
			next.once("connect", () => {
				socket = next;
				connecting = void 0;
				resolve(next);
			});
			next.on("error", (error) => {
				if (socket !== next) {
					connecting = void 0;
					reject(error);
				}
			});
			next.on("close", () => {
				if (socket === next) socket = void 0;
				for (const [key, handler] of waiting) {
					waiting.delete(key);
					handler.onGone();
				}
			});
		});
		return connecting;
	};
	/** Write `message` and wait for `settle` to turn a reply about `key` into a result. */
	async function ask(key, message, timeoutMs, settle, failed) {
		if (closed) return failed(GONE);
		let open;
		try {
			open = await connect();
		} catch {
			return failed(GONE);
		}
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				waiting.delete(key);
				resolve(failed(GONE));
			}, timeoutMs);
			const done = (result) => {
				clearTimeout(timer);
				resolve(result);
			};
			waiting.set(key, {
				onReply(reply) {
					const result = settle(reply);
					if (result === void 0) return false;
					done(result);
					return true;
				},
				onGone: () => done(failed(GONE))
			});
			open.write(`${JSON.stringify(message)}\n`);
		});
	}
	/** The stored entry a stream's end names, shaped for the panel; null when it cannot be read. */
	const readEntry = (sessionId, entryId) => {
		const requestId = `agent-world-${randomUUID()}`;
		return ask(requestId, {
			type: "read_entry",
			requestId,
			sessionId,
			entryId
		}, PAGE_TIMEOUT_MS, (reply) => reply.type !== "entry" ? void 0 : transcriptEntry(reply.entry) ?? null, () => null);
	};
	const replyListeners = /* @__PURE__ */ new Set();
	const emit = (event) => {
		for (const listener of replyListeners) listener(event);
	};
	let watched = [];
	let streams;
	let resubscribe;
	let confirmed;
	const onStreamLine = (reply) => {
		if (reply.type === "subscribed") {
			if (confirmed && JSON.stringify(reply.sessionIds) === confirmed.ids) confirmed.done();
			return;
		}
		const sessionId = typeof reply.sessionId === "string" ? reply.sessionId : void 0;
		const streamId = typeof reply.streamId === "string" ? reply.streamId : void 0;
		if (!sessionId || !streamId) return;
		if (reply.type === "reply_delta" && typeof reply.delta === "string") emit({
			kind: "delta",
			characterId: sessionId,
			streamId,
			seq: Number(reply.seq) || 0,
			delta: reply.delta
		});
		else if (reply.type === "reply_end") {
			const entryId = typeof reply.messageEntryId === "string" ? reply.messageEntryId : void 0;
			if (!entryId) emit({
				kind: "end",
				characterId: sessionId,
				streamId,
				entry: null
			});
			else readEntry(sessionId, entryId).then((entry) => emit({
				kind: "end",
				characterId: sessionId,
				streamId,
				entry
			}));
		}
	};
	/** Open the streams connection if needed, and send it the watched list. */
	const subscribe = () => new Promise((resolve) => {
		const ids = JSON.stringify(watched);
		const timer = setTimeout(() => finish(), SUBSCRIBE_TIMEOUT_MS);
		const finish = () => {
			clearTimeout(timer);
			if (confirmed?.done === finish) confirmed = void 0;
			resolve();
		};
		confirmed?.done();
		confirmed = {
			ids,
			done: finish
		};
		const send = (socket) => socket.write(`${JSON.stringify({
			type: "subscribe",
			sessionIds: watched
		})}\n`);
		if (streams && !streams.destroyed) {
			send(streams);
			return;
		}
		if (closed || !watched.length) return finish();
		const next = createConnection(socketPath);
		streams = next;
		let buffer = "";
		next.on("data", (chunk) => {
			buffer += chunk.toString();
			for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				try {
					onStreamLine(JSON.parse(line));
				} catch {}
			}
		});
		next.once("connect", () => send(next));
		next.on("error", () => {});
		next.on("close", () => {
			if (streams !== next) return;
			streams = void 0;
			clearTimeout(resubscribe);
			if (!closed && watched.length) resubscribe = setTimeout(() => void subscribe(), RESUBSCRIBE_MS).unref();
		});
	});
	return {
		page(sessionId, before) {
			const requestId = `agent-world-${randomUUID()}`;
			return ask(requestId, {
				type: "read_entries",
				requestId,
				sessionId,
				limit: 50,
				...before ? { before } : {}
			}, PAGE_TIMEOUT_MS, (reply) => {
				if (reply.type !== "entries") return void 0;
				if (typeof reply.error === "string") return {
					ok: false,
					reason: reply.error
				};
				return {
					ok: true,
					entries: (Array.isArray(reply.entries) ? reply.entries : []).map(transcriptEntry).filter((entry) => entry !== void 0),
					before: typeof reply.before === "string" ? reply.before : null,
					missing: Array.isArray(reply.missing) ? reply.missing.length : 0
				};
			}, (reason) => ({
				ok: false,
				reason
			}));
		},
		markSeen(sessionId) {
			const commandId = `agent-world-${randomUUID()}`;
			return ask(commandId, {
				type: "command",
				commandId,
				sessionId,
				command: { kind: "mark_seen" }
			}, COMMAND_TIMEOUT_MS, (reply) => {
				if (reply.type !== "receipt") return void 0;
				if (reply.stage === "applied") return { ok: true };
				if (reply.stage === "failed") return {
					ok: false,
					reason: String(reply.reason ?? "failed")
				};
			}, (reason) => ({
				ok: false,
				reason
			}));
		},
		watch(sessionIds) {
			watched = [...new Set(sessionIds)];
			return subscribe();
		},
		onReply(listener) {
			replyListeners.add(listener);
			return () => replyListeners.delete(listener);
		},
		close() {
			closed = true;
			clearTimeout(resubscribe);
			confirmed?.done();
			socket?.destroy();
			streams?.destroy();
			replyListeners.clear();
		}
	};
}
//#endregion
//#region apps/agent-world/src/backend/instructions.ts
/** The longest text an instruction may carry; Pi takes any, but the panel is for messages, not files. */
var TEXT_MAX$1 = 1e5;
var reply = (value) => {
	if (!value || typeof value !== "object") return void 0;
	const { selected, custom } = value;
	if (typeof custom === "string") return { custom };
	if (Array.isArray(selected) && selected.every((label) => typeof label === "string")) return { selected };
};
/** The command an instruction sends to `character`, or why it is refused (and nothing is sent). */
function instructionCommand(character, instruction) {
	if (!character) return { refused: "No such character is awake." };
	const given = instruction ?? {};
	switch (given.kind) {
		case "talk":
		case "steer":
		case "follow_up": {
			const text = given.text;
			if (typeof text !== "string" || !text.trim()) return { refused: "There is nothing to send." };
			if (text.length > TEXT_MAX$1) return { refused: "That message is too long to send from here." };
			return { command: {
				kind: given.kind,
				text
			} };
		}
		case "abort":
			if ((character.facts?.run ?? "idle") !== "idle" && given.confirmed !== true) return { refused: `${character.name} is busy; stopping it needs your confirmation.` };
			return { command: { kind: "abort" } };
		case "answer": {
			const replies = Array.isArray(given.replies) ? given.replies.map(reply) : void 0;
			if (typeof given.questionnaire !== "string" || !replies?.length || replies.some((r) => r === void 0)) return { refused: "That answer does not fit the questions." };
			return { command: {
				kind: "answer",
				questionnaire: given.questionnaire,
				replies
			} };
		}
	}
	return { refused: "The conversation panel cannot send that." };
}
/**
* Send an instruction to an awake character through `commands`, reporting each receipt stage. A refused instruction
* reports `failed` with its reason and sends nothing.
*/
async function instruct(commands, character, commandId, instruction, onReceipt) {
	const made = instructionCommand(character, instruction);
	if ("refused" in made) {
		onReceipt("failed", made.refused);
		return {
			ok: false,
			reason: made.refused
		};
	}
	let failed = false;
	const result = await commands.send(character.id, made.command, {
		commandId,
		onReceipt(stage, reason) {
			if (stage === "failed") failed = true;
			onReceipt(stage, reason);
		}
	});
	if (!result.ok && !failed) onReceipt("failed", result.reason);
	return result;
}
//#endregion
//#region apps/agent-world/src/backend/facts.ts
/**
* The facts columns for `select ... from sessions s join incarnations i ...` (the current incarnation). Without
* `intent`, the column reads as null: a runtime started before the migration that adds it keeps running old code until
* it restarts, and its database has no such column.
*/
var factsColumns = (intent) => `s.run_state as runState, s.prompt, s.needs_you_since as needsYouSince,
	s.seen_at as seenAt, s.settled_at as settledAt, s.current_tool as currentTool, s.current_tool_arg as currentToolArg,
	s.current_tool_since as currentToolSince, s.current_task as currentTask, ${intent ? "s.intent" : "null as intent"},
	s.model, s.context_tokens as contextTokens,
	s.context_window as contextWindow, s.cost, i.tmux_socket as tmuxSocket, i.pane_id as paneId,
	(select ts.name from tmux_window_links l join tmux_sessions ts on ts.socket = l.socket and ts.id = l.session_id
		where l.socket = p.socket and l.window_id = p.window_id order by l.window_index limit 1) as tmuxSession,
	(select l.window_index from tmux_window_links l
		where l.socket = p.socket and l.window_id = p.window_id order by l.window_index limit 1) as windowIndex`;
/** Joins for `factsColumns`: the session's current incarnation `i` and its pane `p`. */
var FACTS_JOINS = `left join incarnations i on i.session_id = s.id and i.generation = s.generation
left join tmux_panes p on p.socket = i.tmux_socket and p.id = i.pane_id`;
function parse$3(json) {
	if (!json) return void 0;
	try {
		return JSON.parse(json);
	} catch {
		return;
	}
}
var PARSED_KEPT = 2e4;
var parsed = /* @__PURE__ */ new Map();
/**
* `JSON.parse` for column values that repeat from read to read (`git`, `config`, `current_task`), parsed once each.
* The values are shared between readers: never change one.
*/
function parseShared(json) {
	if (!json) return void 0;
	if (parsed.has(json)) return parsed.get(json);
	if (parsed.size >= PARSED_KEPT) parsed.clear();
	const value = parse$3(json);
	parsed.set(json, value);
	return value;
}
var text$1 = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
/** The questions of an `ask_user_question` prompt, as the panel's form needs them; undefined when they do not parse. */
function questionsOf(value) {
	if (!Array.isArray(value) || !value.length) return void 0;
	const questions = [];
	for (const raw of value) {
		const question = text$1(raw?.question);
		const options = Array.isArray(raw?.options) ? raw.options.map((option) => ({
			label: typeof option?.label === "string" ? option.label : "",
			description: typeof option?.description === "string" ? option.description : ""
		})) : [];
		if (!question || !options.length || options.some((option) => !option.label)) return void 0;
		questions.push({
			question,
			header: text$1(raw.header),
			options,
			multiSelect: raw.multiSelect === true
		});
	}
	return questions;
}
/**
* The open prompt's kind and what it asks: its title, or else its first question. A questionnaire also carries its id
* and questions, so the conversation panel can answer it.
*/
function asking(prompt) {
	if (prompt === null) return null;
	const open = parse$3(prompt);
	const first = Array.isArray(open?.questions) ? open.questions[0] : void 0;
	const kind = text$1(open?.kind) ?? "dialog";
	const shown = {
		kind,
		text: text$1(open?.title) ?? text$1(first?.question)
	};
	const questions = kind === "questionnaire" ? questionsOf(open?.questions) : void 0;
	const id = text$1(open?.id);
	return questions && id ? {
		...shown,
		questionnaire: {
			id,
			questions
		}
	} : shown;
}
/**
* Reads ledger tasks' `task.md`, again only when the file changed. With `recheck` false, a file read before is not
* even checked for changes: the inn's thousands of sleepers are checked only on the backend's task rereads.
*/
function taskReader() {
	const cache = /* @__PURE__ */ new Map();
	return (currentTask, recheck = true) => {
		const task = parseShared(currentTask);
		if (typeof task?.bundle !== "string" || typeof task.taskId !== "string") return null;
		const file = join(task.bundle, "task.md");
		let read = cache.get(file);
		if (read && !recheck) return {
			title: read.title || task.taskId,
			status: read.status || null,
			bundle: task.bundle
		};
		try {
			const mtime = statSync(file).mtimeMs;
			if (read?.mtime !== mtime) {
				let title = null;
				let status = null;
				for (const line of readFileSync(file, "utf8").split("\n")) if (status === null && line.startsWith("Status:")) status = line.slice(7).trim();
				else if (title === null && line.startsWith("# ")) title = line.slice(2).trim();
				read = {
					mtime,
					title,
					status
				};
				cache.set(file, read);
			}
		} catch {
			read = {
				mtime: -1,
				title: null,
				status: null
			};
			cache.set(file, read);
		}
		return {
			title: read?.title || task.taskId,
			status: read?.status || null,
			bundle: task.bundle
		};
	};
}
function factsOf(row, readTask) {
	const open = asking(row.prompt);
	const git = parse$3(row.git);
	return {
		run: row.runState,
		status: open ? "asking" : row.runState !== "idle" ? "working" : "idle",
		asking: open,
		needsYouSince: row.needsYouSince,
		unseen: row.needsYouSince !== null && open === null,
		seenAt: row.seenAt,
		settledAt: row.settledAt,
		tool: row.currentTool ? {
			name: row.currentTool,
			arg: row.currentToolArg,
			since: row.currentToolSince
		} : null,
		task: readTask(row.currentTask),
		intent: text$1(row.intent),
		git: git && typeof git.repository === "string" ? {
			repository: git.repository,
			worktree: String(git.worktree ?? ""),
			branch: String(git.branch ?? "")
		} : null,
		cwd: row.cwd,
		reportsTo: row.reportsTo,
		model: row.model,
		contextTokens: row.contextTokens,
		contextWindow: row.contextWindow,
		cost: row.cost ?? 0,
		tmux: row.tmuxSocket && row.paneId ? {
			socket: row.tmuxSocket,
			pane: row.paneId,
			session: row.tmuxSession,
			window: row.windowIndex
		} : null
	};
}
//#endregion
//#region apps/agent-world/src/backend/inn.ts
var run$1 = promisify(execFile);
var TMUX_TIMEOUT_MS$1 = 2e3;
var sameAgent = (a, b) => Object.keys(a).every((key) => key === "task" ? a.task === b.task || a.task?.title === b.task?.title && a.task?.status === b.task?.status && a.task?.bundle === b.task?.bundle : a[key] === b[key]);
var sameSleeper = (agent, sleeper) => Object.keys(sleeper).every((key) => agent[key] === sleeper[key]);
/** The row each agent was made from, so an agent whose row object is unchanged can be kept as it is. */
var madeFrom = /* @__PURE__ */ new WeakMap();
/**
* The inn's sleepers with their observed facts, the most recently stopped first. When nothing changed since
* `previous`, returns `previous` itself, so the backend can tell an unchanged inn without comparing it. With `keep`,
* an agent made from the same row object as before is kept without reading its task again.
*/
function dormantAgents(sleepers, rows, readTask, previous = [], keep = false) {
	const before = keep ? new Map(previous.map((agent) => [agent.id, agent])) : void 0;
	const next = sleepers.map((sleeper) => {
		const row = rows.get(sleeper.id);
		const kept = before?.get(sleeper.id);
		if (kept && madeFrom.get(kept) === row && sameSleeper(kept, sleeper)) return kept;
		return made(sleeper, row, readTask);
	});
	if (next.length !== previous.length || next.some((agent, i) => agent !== previous[i] && !sameAgent(agent, previous[i]))) return next;
	for (const [i, agent] of previous.entries()) madeFrom.set(agent, madeFrom.get(next[i]));
	return previous;
}
function made(sleeper, row, readTask) {
	const git = parseShared(row?.git);
	const agent = {
		...sleeper,
		reportsTo: row?.reportsTo ?? null,
		repository: typeof git?.repository === "string" ? git.repository : null,
		cwd: row?.cwd ?? "",
		task: readTask(row?.currentTask ?? null),
		stopReason: row?.stopReason ?? null
	};
	madeFrom.set(agent, row);
	return agent;
}
/**
* The pane of the operator's most recently active tmux client, across the servers the runtime knows. Undefined when
* no terminal is attached to any of them.
*/
async function operatorPane(sockets) {
	const latest = (await Promise.all(sockets.map(async (socket) => {
		try {
			const { stdout } = await run$1("tmux", [
				"-S",
				socket,
				"list-clients",
				"-F",
				"#{client_activity}	#{pane_id}"
			], {
				timeout: TMUX_TIMEOUT_MS$1,
				encoding: "utf8"
			});
			return stdout.split("\n").filter(Boolean).map((line) => {
				const [activity, pane] = line.split("	");
				return {
					socket,
					pane,
					activity: Number(activity) || 0
				};
			}).filter((client) => client.pane);
		} catch {
			return [];
		}
	}))).flat().sort((a, b) => b.activity - a.activity)[0];
	return latest ? {
		socket: latest.socket,
		pane: latest.pane
	} : void 0;
}
//#endregion
//#region apps/agent-world/src/backend/lifecycle.ts
/** A woken session joins once Pi has started in its window; a slow start still says the window opened. */
var WAKE_MS = 3e4;
/** Mail to an awake session is delivered once its transcript records it, usually within a second or two. */
var MAIL_MS = 8e3;
var CLOSE_MS = 1e4;
/** A rename is applied as soon as the bridge has it. */
var RENAME_MS = 8e3;
/** A directory as the operator typed it: `~` is his home. */
var expandHome = (path) => path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
var isDirectory = (path) => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};
/** Send `command` and resolve at the first stage `enough` accepts, or with the last stage reached after `ms`. */
function follow(commands, sessionId, command, ms, enough, late) {
	return new Promise((resolve) => {
		let last;
		let done = false;
		const settle = (receipt) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(receipt);
		};
		const timer = setTimeout(() => {
			if (!last || last.stage === "failed") return;
			settle({
				ok: true,
				stage: last.stage,
				note: late(last.stage)
			});
		}, ms);
		commands.send(sessionId, command, { onReceipt(stage, reason) {
			last = {
				stage,
				reason
			};
			if (stage !== "failed" && enough(stage, reason)) settle({
				ok: true,
				stage,
				...reason ? { note: reason } : {}
			});
		} }).then((result) => settle(result.ok ? {
			ok: true,
			stage: "applied"
		} : {
			ok: false,
			reason: result.reason
		}));
	});
}
function openLifecycle(paths, commands, snapshot) {
	/** The tmux servers the runtime knows, read from its database. */
	const servers = () => {
		if (!existsSync(paths.db)) return [];
		const db = new DatabaseSync(paths.db);
		try {
			db.exec("pragma query_only = 1");
			return db.prepare("select socket from tmux_servers order by updated_at desc").all().map((row) => row.socket);
		} catch {
			return [];
		} finally {
			db.close();
		}
	};
	return {
		async wake(characterId) {
			const world = snapshot();
			const sleeper = world.dormant?.find((agent) => agent.id === characterId);
			if (!sleeper) {
				const awake = world.characters.find((character) => character.id === characterId);
				return {
					ok: false,
					reason: awake ? `${awake.name} is already awake.` : "No stopped session has that id."
				};
			}
			const pane = await operatorPane(servers());
			if (!pane) return {
				ok: false,
				reason: `No terminal is attached to tmux, so there is nowhere to open ${sleeper.name}'s window.`
			};
			return follow(commands, characterId, {
				kind: "start",
				tmux: pane,
				...sleeper.reportsTo ? { reportsTo: sleeper.reportsTo } : {}
			}, WAKE_MS, (stage) => stage === "applied", () => `Its window opened, but ${sleeper.name} has not joined yet.`);
		},
		async endSession(characterId, confirmed = false) {
			const character = snapshot().characters.find((c) => c.id === characterId);
			if (!character) return {
				ok: false,
				reason: "That session is not running."
			};
			if (character.facts !== void 0 && character.facts.run !== "idle" && !confirmed) return {
				ok: false,
				confirm: true,
				reason: `${character.name} is in the middle of a turn. Ending its session stops that turn.`
			};
			return follow(commands, characterId, { kind: "close" }, CLOSE_MS, (stage) => stage === "applied", () => `${character.name} has not answered yet.`);
		},
		async recruit(request) {
			const name = request.name.replace(/\s+/g, " ").trim();
			const cwd = expandHome(request.cwd.trim());
			const brief = request.brief.trim();
			if (!name) return {
				ok: false,
				reason: "Give the new agent a name."
			};
			if (!cwd) return {
				ok: false,
				reason: "Choose the directory it works in."
			};
			if (!isAbsolute(cwd)) return {
				ok: false,
				reason: `${cwd} is not a full path to a directory.`
			};
			if (!isDirectory(cwd)) return {
				ok: false,
				reason: `${cwd} is not a directory.`
			};
			if (brief.startsWith("-")) return {
				ok: false,
				reason: "The brief cannot start with a dash: Pi would read it as an option."
			};
			let pane;
			if (request.reportsTo) {
				const coordinator = snapshot().characters.find((character) => character.id === request.reportsTo && character.role === "coordinator");
				if (!coordinator) return {
					ok: false,
					reason: "That coordinator is not running."
				};
				const tmux = coordinator.facts?.tmux;
				if (!tmux) return {
					ok: false,
					reason: `${coordinator.name} is not running in tmux, so there is nowhere to open ${name}'s window beside it.`
				};
				pane = {
					socket: tmux.socket,
					pane: tmux.pane
				};
			} else {
				pane = await operatorPane(servers());
				if (!pane) return {
					ok: false,
					reason: `No terminal is attached to tmux, so there is nowhere to open ${name}'s window.`
				};
			}
			const sessionId = randomUUID();
			return {
				...await follow(commands, sessionId, {
					kind: "start",
					tmux: pane,
					cwd,
					name,
					...request.reportsTo ? { reportsTo: request.reportsTo } : {},
					...brief ? { prompt: brief } : {}
				}, WAKE_MS, (stage) => stage === "applied", () => `Its window opened, but ${name} has not joined yet.`),
				sessionId
			};
		},
		async rename(characterId, given) {
			const name = given.replace(/\s+/g, " ").trim();
			if (!name) return {
				ok: false,
				reason: "Give it a name."
			};
			if (name.length > 60) return {
				ok: false,
				reason: `That name is too long: keep it to 60 characters.`
			};
			if (!snapshot().characters.some((character) => character.id === characterId)) return {
				ok: false,
				reason: "That session is not running."
			};
			return follow(commands, characterId, {
				kind: "rename",
				name
			}, RENAME_MS, (stage) => stage === "applied", () => "Sent; it has not taken the name yet.");
		},
		async sendMail(characterId, body) {
			const text = body.trim();
			if (!text) return {
				ok: false,
				reason: "The message is empty."
			};
			return follow(commands, characterId, {
				kind: "mail",
				from: OPERATOR,
				body: text,
				sentAt: (/* @__PURE__ */ new Date()).toISOString()
			}, MAIL_MS, (stage, reason) => stage === "applied" || stage === "accepted" && reason !== void 0, (stage) => stage === "delivered" ? "Handed over; not in its transcript yet." : "Sent; not delivered yet.");
		}
	};
}
//#endregion
//#region apps/agent-world/src/backend/links.ts
/** The longest link Agent World hands to the browser. */
var LINK_MAX = 8192;
/** The link as a full http or https URL, or undefined for anything else. */
function webLink(url) {
	if (typeof url !== "string" || !url || url.length > LINK_MAX) return void 0;
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}
	return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : void 0;
}
/** Open a web link with `open` (Electron's `shell.openExternal`); anything but http and https is refused unopened. */
async function openLink(url, open) {
	const href = webLink(url);
	if (!href) return {
		ok: false,
		reason: "Only web links (http and https) open from Agent World."
	};
	try {
		await open(href);
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			reason: `The browser did not open the link: ${String(error?.message ?? error)}`
		};
	}
}
//#endregion
//#region apps/agent-world/web/game/layout.ts
/** The walk grid: half-tile cells, true where blocked. A cell is blocked when its centre is inside a blocked rect. */
function walkGrid(place) {
	const cols = Math.round(place.cols * 2);
	const rows = Math.round(place.rows * 2);
	const blocked = new Array(cols * rows).fill(false);
	for (const [x, y, w, h] of place.blocked) for (let row = Math.max(0, Math.floor(y * 2)); row < Math.min(rows, Math.ceil((y + h) * 2)); row++) for (let col = Math.max(0, Math.floor(x * 2)); col < Math.min(cols, Math.ceil((x + w) * 2)); col++) {
		const cx = (col + .5) / 2;
		const cy = (row + .5) / 2;
		if (cx >= x && cx < x + w && cy >= y && cy < y + h) blocked[row * cols + col] = true;
	}
	return {
		cols,
		rows,
		blocked
	};
}
//#endregion
//#region apps/agent-world/web/game/pathing.ts
/** Cells per tile: the walk grid is twice as fine as the tiles. */
var CELLS = 2;
var CELL = 1 / CELLS;
/** Clearance is measured only this far; beyond it, the floor is simply open. */
var CLEARANCE_CAP = 1.5;
/** A place's walk grid, with other characters standing at `occupants` (their feet), each covering its own footprint. */
function gridFor(place, occupants = []) {
	const base = walkGrid(place);
	const blocked = Uint8Array.from(base.blocked, (b) => b ? 1 : 0);
	const occupied = new Uint8Array(blocked.length);
	for (const [x, y] of occupants) for (const cell of footprint(x, y, base.cols, base.rows)) occupied[cell] = blocked[cell] ? 0 : 1;
	return withClearance({
		cols: base.cols,
		rows: base.rows,
		blocked,
		occupied,
		clearance: /* @__PURE__ */ new Float32Array(0)
	});
}
/** The cells a standing character's feet cover: those whose centres lie within half a tile across, a third deep. */
function footprint(x, y, cols, rows) {
	const cells = [];
	for (let row = Math.floor((y - .35) * CELLS); row <= Math.floor((y + .35) * CELLS); row++) for (let col = Math.floor((x - .5) * CELLS); col <= Math.floor((x + .5) * CELLS); col++) {
		if (row < 0 || col < 0 || row >= rows || col >= cols) continue;
		const cx = (col + .5) * CELL;
		const cy = (row + .5) * CELL;
		if (Math.abs(cx - x) < .45 && Math.abs(cy - y) < .3) cells.push(row * cols + col);
	}
	return cells;
}
function withClearance(grid) {
	const clearance = new Float32Array(grid.cols * grid.rows);
	for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) clearance[row * grid.cols + col] = taken(grid, row * grid.cols + col) ? 0 : distance(grid, [(col + .5) * CELL, (row + .5) * CELL], true);
	grid.clearance = clearance;
	return grid;
}
var cellOf = (grid, [x, y]) => {
	const col = Math.floor(x * CELLS);
	const row = Math.floor(y * CELLS);
	return col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ? -1 : row * grid.cols + col;
};
/** Whether a cell has furniture or someone standing on it. */
var taken = (grid, cell) => grid.blocked[cell] === 1 || grid.occupied[cell] === 1;
/** Open floor: no furniture, and nobody standing there. */
var isOpen = (grid, point) => {
	const cell = cellOf(grid, point);
	return cell >= 0 && !taken(grid, cell);
};
/** Distance in tiles from `point` to the nearest furniture (and with `people`, footprint) or the edge, capped. */
function distance(grid, [x, y], people) {
	let best = Math.min(CLEARANCE_CAP, x, y, grid.cols * CELL - x, grid.rows * CELL - y);
	if (best <= 0) return 0;
	const reach = Math.ceil(best * CELLS);
	const col0 = Math.floor(x * CELLS);
	const row0 = Math.floor(y * CELLS);
	for (let row = Math.max(0, row0 - reach); row <= Math.min(grid.rows - 1, row0 + reach); row++) for (let col = Math.max(0, col0 - reach); col <= Math.min(grid.cols - 1, col0 + reach); col++) {
		const cell = row * grid.cols + col;
		if (!grid.blocked[cell] && !(people && grid.occupied[cell])) continue;
		const dx = Math.max(col * CELL - x, 0, x - (col + 1) * CELL);
		const dy = Math.max(row * CELL - y, 0, y - (row + 1) * CELL);
		const d = Math.hypot(dx, dy);
		if (d < best) {
			best = d;
			if (best === 0) return 0;
		}
	}
	return best;
}
/**
* Frames in a look's idle sheet (`<look>-idle.png`, optional): standing poses played now and then by someone standing
* about, in this order.
*/
var IDLE_POSES = [
	"look-left",
	"look-right",
	"stretch",
	"wave",
	"laugh",
	"shrug",
	"nod",
	"yawn"
];
/** The four painted expressions every look has, in the order of their files (`<look>-portrait-0..3.png`). */
var EXPRESSIONS = [
	"neutral",
	"happy",
	"thinking",
	"worried"
];
/** Every place a pack paints, by data file. */
var PLACE_FILES = [
	"headquarters",
	"common-room",
	"gallery",
	"wing-small",
	"wing-large",
	"square",
	"street",
	"inn",
	"rookery",
	"forge",
	"quest-office",
	"library"
];
/** What the world calls each kind of place: every pack names them all (`wing` follows a repository's name). */
var PLACE_LABELS = [
	"headquarters",
	"common-room",
	"gallery",
	"wing",
	"square",
	"street",
	"forge",
	"quest-office",
	"library",
	"inn",
	"rookery"
];
/** Roles every pack names: the three kinds of character, and each place's host and the townsfolk. */
var ROLE_LABELS = [
	"coordinator",
	"worker",
	"independent",
	"innkeeper",
	"rookery-keeper",
	"smith",
	"clerk",
	"librarian",
	"crier",
	"townsfolk",
	"recruiter"
];
/** Every look role a pack must wear, with how many looks at least (agents need a few to tell apart). */
var LOOK_ROLES = {
	agent: 3,
	coordinator: 1,
	avatar: 1,
	townsfolk: 1,
	innkeeper: 1,
	"rookery-keeper": 1,
	smith: 1,
	clerk: 1,
	librarian: 1,
	crier: 1
};
/**
* Overlays every pack draws: doors in three states, the wing banner, the birds that carry mail, and the pointer's art
* (the cursor's hand pointing, tapping, and as a fist, and the yellow and red click markers).
*/
var REQUIRED_OVERLAYS = [
	"cursor-point",
	"cursor-tap",
	"cursor-blocked",
	"mark-walk",
	"mark-act",
	"door-open",
	"door-closed",
	"door-boarded",
	"banner-cream",
	"bird-0",
	"bird-1",
	"bird-2",
	"bird-3"
];
/**
* Overlays a pack needs only when one of its places has a slot of that kind: ambient animation is optional, and an inn
* may seat its sleepers at tables rather than in beds.
*/
var SLOT_OVERLAYS = {
	fire: [
		"fire-0",
		"fire-1",
		"fire-2",
		"fire-3"
	],
	water: [
		"water-0",
		"water-1",
		"water-2",
		"water-3"
	],
	bed: ["bed"],
	letters: ["letters"],
	work: [
		"blade-passing",
		"blade-failing",
		"blade-running"
	],
	notice: [
		"notice-open",
		"notice-urgent",
		"notice-progress",
		"notice-done"
	]
};
/**
* Fidget objects (decision 27): pure play in a place's `fidget` slots, never work. Each kind names its sprites and its
* plays, the first of which is what a left click does (a toggle offers the one that fits its state). A pack that
* places a kind draws its sprites and names it in `theme.json`'s `fidgets` (its name, an Examine line, and a verb for
* each play); a pack that places none needs neither. `w` is how wide it stands, in tiles, unless the pack or the slot
* says otherwise.
*/
var FIDGETS = {
	/**
	* A pet (a cat, a dog, an owl): four poses (`FidgetStyle.frames`). A slot's `look` draws one of the pack's other
	* pets (`pet-<look>-0..3`) instead of these.
	*/
	pet: {
		art: [
			"pet-0",
			"pet-1",
			"pet-2",
			"pet-3"
		],
		plays: ["pet", "play"],
		w: .95
	},
	/** A globe, a spinner, a goldfish bowl: four frames of one loop. */
	spin: {
		art: [
			"spin-0",
			"spin-1",
			"spin-2",
			"spin-3"
		],
		plays: ["spin", "nudge"],
		w: .65
	},
	/** A bell on a stand, still and ringing. */
	bell: {
		art: ["bell-still", "bell-ringing"],
		plays: ["ring", "peal"],
		w: .6
	},
	/** A bell in the hand, rung by swinging it. */
	handbell: {
		art: ["bell"],
		plays: ["ring", "peal"],
		w: .32
	},
	/** A candelabra, a lamp, a lantern: off and on, with a glow. */
	light: {
		art: ["light-off", "light-on"],
		plays: ["on", "off"],
		w: .5
	},
	/** A music box, an espresso machine, a bento: closed and open. */
	box: {
		art: ["box-closed", "box-open"],
		plays: ["open", "close"],
		w: .7
	},
	/** A pet curled up asleep. */
	sleeper: {
		art: ["cat-sleeping"],
		plays: ["pet", "boop"],
		w: .95
	},
	/** A lit candle or lamp that stays lit. */
	candle: {
		art: ["candle"],
		plays: ["blow", "cup"],
		w: .36
	},
	/** A book, a tablet, a notebook: leafed through, it shows a line. */
	tome: {
		art: ["tome"],
		plays: ["leaf"],
		w: .75
	}
};
/** The little drawn things a play gives off. */
var FIDGET_PARTICLES = [
	"hearts",
	"notes",
	"sparkles",
	"steam",
	"bubbles",
	"smoke",
	"zzz"
];
/**
* What a pet's sprites show, one each: sitting (how it rests), petted with its eyes closed, a playful pose, stretching,
* and curled up asleep. A pet has four, `sit`, `petted`, and `play` among them.
*/
var PET_FRAMES = [
	"sit",
	"petted",
	"play",
	"stretch",
	"sleep"
];
/** The order of a pet's sprites where its style does not say. */
var PET_FRAME_ORDER = [
	"sit",
	"petted",
	"play",
	"sleep"
];
/** A pet's four sprites: the kind's own (`pet-0..3`), or those of one of the pack's other pets (`pet-<look>-0..3`). */
var petArt = (look) => look ? [
	0,
	1,
	2,
	3
].map((frame) => `pet-${look}-${frame}`) : [...FIDGETS.pet.art];
/**
* A fidget slot's style: for a pet with a `look`, that look's own name, Examine line, size, frames, and reactions over
* the kind's (its verbs fall back to the kind's, play by play).
*/
function slotStyle(style, slot) {
	const own = slot.look ? style.looks?.[slot.look] : void 0;
	if (!own) return style;
	return {
		...style,
		...own,
		verbs: {
			...style.verbs,
			...own.verbs
		},
		frames: own.frames,
		looks: void 0
	};
}
/** The idles a cast member may play as its gesture when it reacts (the world's idles, `character-life.ts`). */
var AMBIENT_GESTURES = [
	"look-around",
	"stretch",
	"wave",
	"laugh",
	"shrug",
	"nod",
	"yawn"
];
/**
* What a place must have beyond the shared format: its host's look role, slots it cannot do without, a recruiter (and
* why), and furniture by its `use` (and why).
*/
var PLACE_NEEDS = {
	forge: {
		host: "smith",
		slots: { work: "the forge lays its pull requests on them" }
	},
	"quest-office": {
		host: "clerk",
		slots: { notice: "the quest office pins the operator's issues on them" }
	},
	library: { host: "librarian" },
	square: {
		host: "crier",
		recruiter: "the square's recruiter recruits independent agents at its booth"
	},
	headquarters: { furniture: { recruit: "the coordinator's desk recruits workers there" } }
};
/**
* Theme-flavoured lines the world says, by key; `{name}`, `{count}`, and the like are filled in. Everything else the
* world says is plain and the same in every theme.
*/
var TEXT_KEYS = [
	"banner-reads",
	"headquarters-empty",
	"ask-host",
	"ask-upstairs",
	"upstairs-count",
	"asleep-here",
	"asleep-count",
	"nobody-asleep",
	"register-title",
	"register-greeting",
	"register-upstairs",
	"register-empty",
	"register-search",
	"sleeper-upstairs",
	"sleeper-bed",
	"sleeper-table",
	"letter",
	"letter-placeholder",
	"letter-for-sleeper",
	"write-letter",
	"letter-waits",
	"letters-wait",
	"rookery-greeting",
	"rookery-waiting",
	"rookery-empty",
	"waiting-for-sleepers",
	"letter-sending",
	"letter-reached",
	"end-session-after",
	"session-ended",
	"conversation-opening",
	"conversation-older",
	"conversation-asleep",
	"quest-greeting",
	"quest-greeting-one",
	"quest-empty",
	"quest-signed-out",
	"quest-search",
	"quest-more",
	"library-greeting",
	"library-signed-out",
	"library-search",
	"library-recent",
	"library-recent-empty",
	"crier-greeting",
	"crier-quiet",
	"crier-signed-out",
	"crier-search",
	"forge-greeting",
	"forge-empty",
	"forge-loading",
	"ask-smith",
	"forge-more",
	"recruit-worker",
	"recruit-independent",
	"recruit-worker-title",
	"recruit-independent-title",
	"recruit-worker-greeting",
	"recruit-independent-greeting",
	"recruit-brief",
	"recruit-send",
	"recruit-sending",
	"recruit-joined"
];
/**
* Style tokens every pack sets: CSS custom properties put on the page's root, which the pack's skin and the world
* UI's own CSS read. Fonts, the inks, the accent, and the main surfaces of the interface frame and the conversation
* panel. A value may name a file in the pack with `url(...)`, relative to the pack.
*/
var STYLE_TOKENS = [
	"--aw-font-body",
	"--aw-font-display",
	"--aw-font-figures",
	"--aw-font-mono",
	"--aw-backdrop",
	"--aw-ink",
	"--aw-ink-soft",
	"--aw-ink-faint",
	"--aw-accent",
	"--aw-accent-light",
	"--aw-danger",
	"--aw-frame-background",
	"--aw-frame-shadow",
	"--aw-surface-background",
	"--aw-panel-cover",
	"--aw-panel-page",
	"--aw-veil"
];
/**
* The side panel's tabs whose icon a pack may draw: an optional style token `--aw-icon-<tab>` naming an SVG in the pack
* (`url(interface/icons/work.svg)`), drawn in the tab's ink through a mask. A tab without one wears the world's own.
*/
var TAB_ICONS = [
	"agents",
	"needs-you",
	"work",
	"mail",
	"slack",
	"places",
	"settings"
];
/**
* Classes a skin must style: the interface's frames and surfaces, its tabs and buttons, the conversation panel and
* its panes, the places' panels, and the pointer's menu. A skin that leaves one out draws a bare browser widget.
*/
var SKIN_CLASSES = [
	"aw-interface",
	"aw-frame",
	"aw-surface",
	"aw-tab",
	"aw-button",
	"aw-orb-glass",
	"aw-pip",
	"aw-filter",
	"aw-conv-veil",
	"aw-conv-panel",
	"aw-conv-pane",
	"aw-conv-close",
	"aw-cta",
	"aw-conv-input",
	"aw-md-code",
	"aw-place-veil",
	"aw-place-close",
	"aw-mail-row",
	"pointer-menu",
	"place-title",
	"notice"
];
/** The kinds of atmosphere a place may have (`Atmosphere`). */
var ATMOSPHERE_KINDS = [
	"motes",
	"fall",
	"sky",
	"steam",
	"sparks",
	"blink",
	"screens",
	"shimmer",
	"lights"
];
/** What a `fall` lets fall and what crosses a `sky`. */
var ATMOSPHERE_WHAT = {
	fall: ["leaves", "petals"],
	sky: ["birds", "plane"]
};
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isNumber = (value) => typeof value === "number" && Number.isFinite(value);
var isPoint = (value) => Array.isArray(value) && value.length === 2 && value.every(isNumber);
var isRect = (value) => Array.isArray(value) && value.length === 4 && value.every(isNumber);
var isColour = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
var isFraction = (value) => isNumber(value) && value >= 0 && value <= 1;
var fmt = (p) => `[${p.join(", ")}]`;
/** How far an image's sides may stray from the place's tile grid before the grid no longer lies on the painting. */
var ASPECT_TOLERANCE = .02;
/** How far a frame's feet may be from the look's baseline, and its standing height from `STANDING_HEIGHT` (px). */
var BASELINE_TOLERANCE = 1;
var HEIGHT_TOLERANCE = 3;
/** Alpha at or above this counts as drawn. */
var OPAQUE = 128;
async function json(reader, file, problems) {
	const text = await reader.text(file);
	if (text === void 0) {
		problems.push({
			file,
			fault: "is missing"
		});
		return;
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		problems.push({
			file,
			fault: `is not valid JSON (${error.message})`
		});
		return;
	}
}
/** Files a CSS value names with `url(...)`, other than data URLs, relative to where the value lives. */
function urls(css) {
	const found = [];
	const plain = css.replace(/url\(\s*(["'])data:.*?\1\s*\)/gs, "");
	for (const match of plain.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
		const url = match[2].trim();
		if (!/^(data:|https?:|#)/i.test(url)) found.push(url);
	}
	return found;
}
/** A path inside the pack, from `dir` (pack-relative, '' for its root) and a relative reference. */
function within(dir, ref) {
	const parts = dir ? dir.split("/") : [];
	for (const part of ref.split("/")) if (part === "..") {
		if (!parts.length) return void 0;
		parts.pop();
	} else if (part && part !== ".") parts.push(part);
	return parts.join("/");
}
function checkManifest(value, id, problems) {
	const file = "theme.json";
	if (!isObject(value)) {
		problems.push({
			file,
			fault: "is not an object"
		});
		return;
	}
	const fault = (text) => problems.push({
		file,
		fault: text
	});
	if (value.id !== id) fault(`names the theme ${JSON.stringify(value.id)}, but its directory is ${id}`);
	if (typeof value.name !== "string" || !value.name.trim()) fault("has no name");
	const table = (key, names, what) => {
		const entries = value[key];
		if (!isObject(entries)) return fault(`has no ${key}`);
		const missing = names.filter((name) => typeof entries[name] !== "string" || !entries[name].trim());
		if (missing.length) fault(`has no ${what} for ${missing.join(", ")}`);
	};
	table("labels", [...PLACE_LABELS, ...ROLE_LABELS], "label");
	table("text", TEXT_KEYS, "line");
	table("style", STYLE_TOKENS, "style token");
	for (const [token, css] of Object.entries(isObject(value.style) ? value.style : {})) {
		if (!token.startsWith("--aw-icon-")) continue;
		const tab = token.slice(10);
		if (!TAB_ICONS.includes(tab)) fault(`style ${token} names no tab (a tab icon is one of ${TAB_ICONS.map((t) => `--aw-icon-${t}`).join(", ")})`);
		else if (typeof css !== "string" || !/^url\(\s*['"]?[^'")]+\.svg['"]?\s*\)$/i.test(css.trim())) fault(`style ${token} is not url(...) of an SVG in the pack: ${JSON.stringify(css)}`);
	}
	if (typeof value.skin !== "string" || !value.skin.endsWith(".css")) fault("names no skin stylesheet (skin: *.css)");
	const world = value.world;
	if (!isObject(world)) {
		fault("has no world style");
		return value;
	}
	const colours = (path, object, keys) => {
		if (!isObject(object)) return fault(`has no world.${path}`);
		for (const key of keys) if (!isColour(object[key])) fault(`world.${path}.${key} is not a #rrggbb colour: ${JSON.stringify(object[key])}`);
	};
	if (!isColour(world.backdrop)) fault(`world.backdrop is not a #rrggbb colour: ${JSON.stringify(world.backdrop)}`);
	if (typeof world.font !== "string" || !world.font.trim()) fault("has no world.font");
	colours("bark", world.bark, [
		"paper",
		"ink",
		"outline"
	]);
	colours("tag", world.tag, [
		"plate",
		"rim",
		"rivet",
		"ink"
	]);
	colours("sleep", world.sleep, ["fill", "stroke"]);
	colours("badge", world.badge, ["rim", "edge"]);
	for (const kind of [
		"asking",
		"unseen",
		"working"
	]) colours(`badge.${kind}`, isObject(world.badge) ? world.badge[kind] : void 0, [
		"fill",
		"light",
		"ink"
	]);
	if (!Array.isArray(world.glow) || world.glow.length !== 3 || !world.glow.every(isColour)) fault("world.glow is not three #rrggbb colours");
	const banner = world.banner;
	if (!isObject(banner) || !isNumber(banner.tiles) || banner.tiles <= 0 || !isRect(banner.text) || !banner.text.every(isFraction) || !isRect(banner.hover) || !banner.hover.every(isFraction) || !isColour(banner.ink)) fault("world.banner needs tiles, text and hover as fractions [x, y, w, h], and a #rrggbb ink");
	const bed = world.bed;
	if (bed !== void 0 && (!isObject(bed) || !isPoint(bed.pillow) || !Array.isArray(bed.covers) || bed.covers.length < 3 || !bed.covers.every(isPoint))) fault("world.bed needs a pillow point and a covers polygon (px in bed.png)");
	const notice = world.notice;
	if (notice !== void 0 && (!isObject(notice) || !isRect(notice.paper) || !notice.paper.every(isFraction))) fault("world.notice needs paper as fractions [x, y, w, h] of the notice sprites");
	const sign = world.sign;
	if (sign !== void 0) {
		if (!isObject(sign)) fault("world.sign is not an object");
		else {
			if (!isText(sign.font)) fault("world.sign has no font");
			colours("sign", sign, ["ink", ...sign.shadow === void 0 ? [] : ["shadow"]]);
			if (sign.plate !== void 0) colours("sign.plate", sign.plate, [
				"fill",
				"rim",
				"edge"
			]);
		}
	}
	checkFidgetStyles(value.fidgets, fault);
	checkCast(value.ambient, fault);
	return value;
}
var isText = (value) => typeof value === "string" && value.trim().length > 0;
var isFidget = (kind) => typeof kind === "string" && Object.hasOwn(FIDGETS, kind);
/** The manifest's `fidgets`, when there: each a known kind with its name, Examine line, and a verb for every play. */
function checkFidgetStyles(fidgets, fault) {
	if (fidgets === void 0) return;
	if (!isObject(fidgets)) return fault("fidgets is not an object of fidget kinds");
	for (const [kind, style] of Object.entries(fidgets)) {
		if (!isFidget(kind)) {
			fault(`fidgets names ${JSON.stringify(kind)}, which is not a kind of fidget (${Object.keys(FIDGETS).join(", ")})`);
			continue;
		}
		if (!isObject(style)) {
			fault(`fidgets.${kind} is not an object`);
			continue;
		}
		if (!isText(style.name)) fault(`fidgets.${kind} has no name`);
		if (!isText(style.examine)) fault(`fidgets.${kind} has no examine line`);
		const verbs = isObject(style.verbs) ? style.verbs : {};
		const missing = FIDGETS[kind].plays.filter((play) => !isText(verbs[play]));
		if (missing.length) fault(`fidgets.${kind} has no verb for ${missing.join(", ")}`);
		if (style.w !== void 0 && !(isNumber(style.w) && style.w > 0)) fault(`fidgets.${kind}.w is not a width in tiles`);
		if (style.particle !== void 0 && !FIDGET_PARTICLES.includes(style.particle)) fault(`fidgets.${kind}.particle is not one of ${FIDGET_PARTICLES.join(", ")}`);
		if (kind === "tome" && !(Array.isArray(style.lines) && style.lines.length > 0 && style.lines.every(isText))) fault("fidgets.tome has no lines to show when it is leafed through");
		if (kind === "pet") checkPetStyles(style, fault);
	}
}
/** A pet's height and frames, and each of its other looks: a name, an Examine line, and verbs only for its plays. */
function checkPetStyles(style, fault) {
	checkPetLook("fidgets.pet", style, fault);
	if (style.looks === void 0) return;
	if (!isObject(style.looks)) return fault("fidgets.pet.looks is not an object of looks");
	for (const [look, own] of Object.entries(style.looks)) {
		const where = `fidgets.pet.looks.${look}`;
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(look)) fault(`${where} is not a look name (lowercase words joined by -)`);
		if (!isObject(own)) {
			fault(`${where} is not an object`);
			continue;
		}
		if (!isText(own.name)) fault(`${where} has no name`);
		if (!isText(own.examine)) fault(`${where} has no examine line`);
		if (own.verbs !== void 0) {
			const verbs = isObject(own.verbs) ? own.verbs : {};
			const odd = Object.keys(verbs).filter((play) => !FIDGETS.pet.plays.includes(play));
			if (!isObject(own.verbs) || odd.length || !Object.values(verbs).every(isText)) fault(`${where}.verbs names a verb for each of ${FIDGETS.pet.plays.join(", ")} only`);
		}
		if (own.particle !== void 0 && !FIDGET_PARTICLES.includes(own.particle)) fault(`${where}.particle is not one of ${FIDGET_PARTICLES.join(", ")}`);
		checkPetLook(where, own, fault);
	}
}
/** A pet's height (a share of a standing character's) and its four frames, when given. */
function checkPetLook(where, style, fault) {
	if (style.height !== void 0 && !(isNumber(style.height) && style.height > 0 && style.height <= 1.2)) fault(`${where}.height is not a share of a standing character's height (above 0, at most 1.2)`);
	if (style.frames === void 0) return;
	const frames = Array.isArray(style.frames) ? style.frames : [];
	const known = frames.every((frame) => PET_FRAMES.includes(frame));
	if (frames.length !== 4 || !known || new Set(frames).size !== 4 || ![
		"sit",
		"petted",
		"play"
	].every((frame) => frames.includes(frame))) fault(`${where}.frames is not four different frames of ${PET_FRAMES.join(", ")}, with sit, petted, and play`);
}
/**
* Fewer pets, each its own: a place holds at most one pet (a curled-up sleeper counts), no two places share a pet's
* look (nor two hold a sleeper), each look is one the pack names, and an asleep pet has a sleep frame. Returns the
* sprites the placed looks need.
*/
function checkPets(placed, pet, problems) {
	const style = isObject(pet) ? pet : void 0;
	const perPlace = /* @__PURE__ */ new Map();
	const lookAt = /* @__PURE__ */ new Map();
	const art = [];
	for (const { file, slot } of placed) {
		perPlace.set(file, (perPlace.get(file) ?? 0) + 1);
		if (perPlace.get(file) === 2) problems.push({
			file,
			fault: "holds more than one pet (a sleeper counts)"
		});
		const look = slot.fidget === "sleeper" ? "a sleeper" : slot.look ? `pet look ${slot.look}` : "the pet's own look";
		const first = lookAt.get(look);
		if (first) problems.push({
			file,
			fault: `holds ${look}, as ${first} does: no two places share a pet`
		});
		else lookAt.set(look, file);
		if (slot.fidget !== "pet") continue;
		if (!style) {
			art.push(...petArt(typeof slot.look === "string" ? slot.look : void 0));
			continue;
		}
		if (slot.look !== void 0 && !(typeof slot.look === "string" && isObject(style.looks?.[slot.look]))) {
			problems.push({
				file,
				fault: `a pet at ${fmt(slot.at)} wears look ${JSON.stringify(slot.look)}, which fidgets.pet.looks does not name`
			});
			continue;
		}
		const frames = slotStyle(style, slot).frames ?? PET_FRAME_ORDER;
		if (slot.asleep && !frames.includes("sleep")) problems.push({
			file,
			fault: `a pet at ${fmt(slot.at)} is asleep, but its look has no sleep frame`
		});
		art.push(...petArt(slot.look));
	}
	return art;
}
/** A door's sign board, when it has one: a rect inside the grid. */
function checkSign(door, rectInside, fault) {
	if (door.sign === void 0) return;
	if (!isObject(door.sign) || !isRect(door.sign.rect)) fault(`door ${door.name}'s sign has no rect [x, y, w, h]`);
	else if (!rectInside(door.sign.rect)) fault(`door ${door.name}'s sign ${fmt(door.sign.rect)} lies outside its grid`);
}
/** A bed names a spot the place has; a `fidget` slot names a known kind, and a width in tiles if it gives one. */
function checkSlot(slot, place, fault) {
	if (slot.kind === "bed" && slot.spot !== void 0 && !place.spots[slot.spot]) fault(`a bed at ${fmt(slot.at)} names spot ${slot.spot}, which it does not have`);
	if (slot.kind !== "fidget") return;
	if (!isFidget(slot.fidget)) fault(`a fidget slot at ${fmt(slot.at)} names ${slot.fidget === void 0 ? "no kind" : JSON.stringify(slot.fidget)}; fidget is one of ${Object.keys(FIDGETS).join(", ")}`);
	else if (slot.w !== void 0 && !(isNumber(slot.w) && slot.w > 0)) fault(`a fidget slot at ${fmt(slot.at)} has a width (w) that is not a number of tiles`);
	if ((slot.look !== void 0 || slot.asleep !== void 0) && slot.fidget !== "pet") fault(`a fidget slot at ${fmt(slot.at)} gives a look or asleep, which only a pet has`);
}
/**
* Recruiting (ticket 10): a recruiter stands on open floor, and a place that needs one (the square) has it; a place
* that needs furniture of a `use` (the headquarters' recruiting desk) has a piece of it.
*/
function checkRecruiting(place, needs, fault, onFloor) {
	if (place.recruiter === void 0) {
		if (needs?.recruiter) fault(`has no recruiter; ${needs.recruiter}`);
	} else if (!isObject(place.recruiter) || !isPoint(place.recruiter.at)) fault("its recruiter has no place (at)");
	else onFloor("its recruiter", place.recruiter.at);
	const furniture = Array.isArray(place.furniture) ? place.furniture : [];
	for (const [use, why] of Object.entries(needs?.furniture ?? {})) if (!furniture.some((piece) => isObject(piece) && piece.use === use && isRect(piece.rect))) fault(`has no furniture whose use is ${use}; ${why}`);
}
function checkPlace(name, value, painting, problems) {
	const file = `places/${name}.json`;
	const fault = (text) => problems.push({
		file,
		fault: text
	});
	if (!isObject(value)) return fault("is not an object");
	const place = value;
	if (!isNumber(place.cols) || !isNumber(place.rows) || place.cols <= 0 || place.rows <= 0) return fault("has no grid size (cols, rows)");
	if (!Array.isArray(place.blocked) || !place.blocked.every(isRect)) return fault("has no blocked rects [x, y, w, h]");
	if (!Array.isArray(place.spots) || !place.spots.every(isPoint)) return fault("has no spots [x, y]");
	if (!isObject(place.entries) || !Object.values(place.entries).every(isPoint)) return fault("has no entries");
	if (!Array.isArray(place.doors) || !place.doors.every((d) => isObject(d) && isRect(d.rect) && isPoint(d.standAt))) return fault("has doors without a rect or a stand point");
	if (!Array.isArray(place.overlaySlots) || !place.overlaySlots.every((s) => isObject(s) && isPoint(s.at))) return fault("has overlay slots without a place (at)");
	if (painting) {
		const across = painting.width / place.cols;
		const down = painting.height / place.rows;
		if (Math.abs(across / down - 1) > ASPECT_TOLERANCE) fault(`grid of ${place.cols} x ${place.rows} tiles does not fit its painting (${painting.width} x ${painting.height} px): ${across.toFixed(1)} px per tile across but ${down.toFixed(1)} down`);
	}
	const inside = ([x, y]) => x >= 0 && y >= 0 && x <= place.cols && y <= place.rows;
	const rectInside = ([x, y, w, h]) => w >= 0 && h >= 0 && inside([x, y]) && inside([x + w, y + h]);
	place.blocked.forEach((rect, i) => {
		if (!rectInside(rect)) fault(`blocked rect ${i} ${fmt(rect)} lies outside its ${place.cols} x ${place.rows} grid`);
	});
	for (const door of place.doors) {
		if (!rectInside(door.rect)) fault(`door ${door.name}'s rect ${fmt(door.rect)} lies outside its grid`);
		checkSign(door, rectInside, fault);
	}
	place.overlaySlots.forEach((slot, i) => {
		if (!inside(slot.at)) fault(`overlay slot ${i} (${slot.kind}) at ${fmt(slot.at)} lies outside its grid`);
	});
	for (const piece of place.foreground ?? []) if (!isRect(piece.rect) || !rectInside(piece.rect)) fault(`foreground piece ${fmt(piece.rect ?? [])} lies outside its grid`);
	if (place.host && !inside(place.host.at)) fault(`its host stands at ${fmt(place.host.at)}, outside its grid`);
	const grid = gridFor(place);
	const onFloor = (what, point) => {
		if (!inside(point)) fault(`${what} ${fmt(point)} lies outside its grid`);
		else if (!isOpen(grid, point)) fault(`${what} ${fmt(point)} is not on open floor`);
	};
	for (const [i, spot] of place.spots.entries()) onFloor(`spot ${i}`, spot);
	for (const [from, point] of Object.entries(place.entries)) onFloor(`entry from ${from}`, point);
	for (const door of place.doors) onFloor(`door ${door.name}'s stand point`, door.standAt);
	checkRecruiting(place, PLACE_NEEDS[name], fault, onFloor);
	checkInterest(place, grid, fault);
	checkAmbientPlaces(place, grid, fault);
	checkAtmosphere(place, rectInside, inside, fault);
	if (place.enterBy !== void 0 && !place.doors.some((door) => door.name === place.enterBy)) fault(`enterBy names ${JSON.stringify(place.enterBy)}, which is not one of its doors`);
	const needs = PLACE_NEEDS[name];
	if (needs?.host && !isObject(place.host)) fault(`has no host; the ${name} needs its ${needs.host}`);
	for (const [kind, why] of Object.entries(needs?.slots ?? {})) if (!place.overlaySlots.some((slot) => slot.kind === kind)) fault(`has no ${kind} slots; ${why}`);
	for (const slot of place.overlaySlots) checkSlot(slot, place, fault);
	if (place.niches) {
		const { at, layouts, repeat } = place.niches;
		if (!Array.isArray(at) || !at.every((x) => isNumber(x) && x >= 0 && x <= place.cols)) fault("has niches outside its grid");
		if (![...Object.values(layouts ?? {}).flat(), repeat].every((s) => Array.isArray(s) && s.length === 2 && s[0] >= 0 && s[1] <= place.cols && s[0] < s[1])) fault("cuts its painting into strips outside its grid");
	}
}
/** A place's atmosphere (ticket 11): each entry a known kind, inside the grid, naming what it may. */
function checkAtmosphere(place, rectInside, inside, fault) {
	if (place.atmosphere === void 0) return;
	if (!Array.isArray(place.atmosphere)) return fault("has an atmosphere that is not a list");
	for (const [i, effect] of place.atmosphere.entries()) {
		if (!isObject(effect) || !ATMOSPHERE_KINDS.includes(effect.kind)) {
			fault(`atmosphere ${i} is ${JSON.stringify(isObject(effect) ? effect.kind : effect)}; kind is one of ${ATMOSPHERE_KINDS.join(", ")}`);
			continue;
		}
		const what = `atmosphere ${i} (${effect.kind})`;
		const rects = [...effect.rect === void 0 ? [] : [effect.rect], ...effect.rects ?? []];
		for (const rect of rects) if (!isRect(rect)) fault(`${what} has a rect that is not [x, y, w, h]`);
		else if (!rectInside(rect)) fault(`${what} ${fmt(rect)} lies outside its grid`);
		if ((effect.kind === "screens" || effect.kind === "lights") && !(Array.isArray(effect.rects) && effect.rects.length)) fault(`${what} has no rects [[x, y, w, h], ...]`);
		if ((effect.kind === "blink" || effect.kind === "shimmer") && effect.rect === void 0) fault(`${what} has no rect [x, y, w, h]`);
		if (effect.kind === "steam" || effect.kind === "sparks") {
			if (!isPoint(effect.at)) fault(`${what} has no place (at)`);
			else if (!inside(effect.at)) fault(`${what} at ${fmt(effect.at)} lies outside its grid`);
		}
		const names = ATMOSPHERE_WHAT[effect.kind];
		if (names && !names.includes(effect.what)) fault(`${what} names ${JSON.stringify(effect.what)}; what is one of ${names.join(", ")}`);
		if (effect.count !== void 0 && !(isNumber(effect.count) && effect.count > 0)) fault(`${what} has a count that is not a positive number`);
		const colours = effect.colors ?? [];
		const wrong = Array.isArray(colours) ? colours.filter((c) => !/^#[0-9a-f]{6}$/i.test(String(c))) : [colours];
		if (wrong.length) fault(`${what} has colours that are not #rrggbb: ${wrong.map((c) => JSON.stringify(c)).join(", ")}`);
	}
}
/**
* A look's idle sheet, when looks.json names one: its strip of `IDLE_POSES` frames in the size it gives, each on its
* baseline (with pixels).
*/
async function checkIdle(reader, name, idle, pixels, problems) {
	const file = `characters/${name}-idle.png`;
	if (!isObject(idle) || !isPoint(idle.frame) || !isNumber(idle.baseline)) return problems.push({
		file: "characters/looks.json",
		fault: `look ${name}'s idle needs a frame [w, h] and a baseline`
	});
	const [w, h] = idle.frame;
	const frames = IDLE_POSES.length;
	const sheet = await reader.image(file, pixels);
	if (!sheet) return problems.push({
		file,
		fault: "is missing (the idle sheet looks.json names)"
	});
	if (sheet.width !== w * frames || sheet.height !== h) return problems.push({
		file,
		fault: `is ${sheet.width} x ${sheet.height} px, but ${frames} idle frames of ${w} x ${h} (looks.json) make ${w * frames} x ${h}`
	});
	const baseline = idle.baseline;
	if (baseline <= 0 || baseline > h) return problems.push({
		file: "characters/looks.json",
		fault: `look ${name}'s idle baseline ${baseline} lies outside its ${h} px frame`
	});
	if (!sheet.alpha) return;
	const off = feetRows(sheet, w, frames).map((row, frame) => ({
		frame,
		row
	})).filter(({ row }) => Math.abs(row + 1 - baseline) > BASELINE_TOLERANCE);
	if (off.length) problems.push({
		file,
		fault: `idle frames ${off.map((o) => o.frame).join(", ")} stand off the baseline ${baseline} (feet at rows ${off.map((o) => o.row + 1).join(", ")})`
	});
}
/**
* A place's points of interest: each named, on open floor inside its grid, a tile clear of every door's stand point and
* every entry (a wanderer never stands in a doorway), and clear of every spot, the host, and the recruiter.
*/
function checkInterest(place, grid, fault) {
	if (place.interest === void 0) return;
	if (!Array.isArray(place.interest)) return fault("has points of interest that are not a list");
	const near = (a, b, least) => Math.hypot(a[0] - b[0], a[1] - b[1]) < least;
	const clear = [
		...place.doors.map((door) => [
			`door ${door.name}'s stand point`,
			door.standAt,
			1
		]),
		...Object.entries(place.entries).map(([from, at]) => [
			`the entry from ${from}`,
			at,
			1
		]),
		...place.spots.map((at, i) => [
			`spot ${i}`,
			at,
			.9
		]),
		...isObject(place.host) && isPoint(place.host.at) ? [[
			"its host",
			place.host.at,
			.9
		]] : [],
		...isObject(place.recruiter) && isPoint(place.recruiter.at) ? [[
			"its recruiter",
			place.recruiter.at,
			.9
		]] : []
	];
	for (const [i, point] of place.interest.entries()) {
		if (!isObject(point) || !isText(point.name)) {
			fault(`point of interest ${i} has no name`);
			continue;
		}
		if (!isPoint(point.at)) {
			fault(`point of interest ${i} has no place (at)`);
			continue;
		}
		const what = `point of interest ${point.name} ${fmt(point.at)}`;
		const [x, y] = point.at;
		if (x < 0 || y < 0 || x > place.cols || y > place.rows) {
			fault(`${what} lies outside its grid`);
			continue;
		}
		if (!isOpen(grid, point.at)) {
			fault(`${what} is not on open floor`);
			continue;
		}
		if (point.face !== void 0 && ![
			"up",
			"down",
			"left",
			"right"
		].includes(point.face)) fault(`${what} faces ${JSON.stringify(point.face)}, not up, down, left, or right`);
		for (const [other, at, least] of clear) if (near(point.at, at, least)) fault(`${what} is within ${least === 1 ? "a tile" : `${least} tiles`} of ${other}`);
	}
}
/** The manifest's ambient cast (ticket 08), when there: each a cast name with its name, look, Examine line, and lines. */
function checkCast(ambient, fault) {
	if (ambient === void 0) return;
	if (!isObject(ambient)) return fault("ambient is not an object of cast members");
	const lines = (value) => Array.isArray(value) && value.every(isText);
	for (const [id, member] of Object.entries(ambient)) {
		const where = `ambient.${id}`;
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fault(`${where} is not a cast name (lowercase words joined by -)`);
		if (!isObject(member)) {
			fault(`${where} is not an object`);
			continue;
		}
		if (!isText(member.name)) fault(`${where} has no name`);
		if (!isText(member.look)) fault(`${where} has no look`);
		if (!isText(member.examine)) fault(`${where} has no examine line`);
		if (!lines(member.lines) || member.lines.length < 3) fault(`${where} has fewer than 3 lines to say when talked to`);
		if (!lines(member.reactions) || !member.reactions.length) fault(`${where} has no reaction to say when clicked again and again`);
		if (member.barks !== void 0 && !lines(member.barks)) fault(`${where}.barks is not a list of lines`);
		if (member.gesture !== void 0 && !AMBIENT_GESTURES.includes(member.gesture)) fault(`${where}.gesture is not one of ${AMBIENT_GESTURES.join(", ")}`);
		if (member.crew !== void 0 && typeof member.crew !== "boolean") fault(`${where}.crew is not true or false`);
	}
}
/**
* Where a place's cast members stand: each names one, on open floor inside the grid, a tile clear of every door's stand
* point and entry, and clear of every spot, the host, the recruiter, the points of interest, and one another.
*/
function checkAmbientPlaces(place, grid, fault) {
	if (place.ambient === void 0) return;
	if (!Array.isArray(place.ambient)) return fault("has ambient characters that are not a list");
	const near = (a, b, least) => Math.hypot(a[0] - b[0], a[1] - b[1]) < least;
	const point = (what, at, least) => isPoint(at) ? [[
		what,
		at,
		least
	]] : [];
	const clear = [
		...place.doors.flatMap((door) => point(`door ${door.name}'s stand point`, door.standAt, 1)),
		...Object.entries(place.entries).flatMap(([from, at]) => point(`the entry from ${from}`, at, 1)),
		...place.spots.flatMap((at, i) => point(`spot ${i}`, at, .9)),
		...point("its host", isObject(place.host) ? place.host.at : void 0, .9),
		...point("its recruiter", isObject(place.recruiter) ? place.recruiter.at : void 0, .9),
		...(Array.isArray(place.interest) ? place.interest : []).flatMap((p) => isObject(p) ? point(`point of interest ${p.name}`, p.at, .9) : [])
	];
	for (const [i, entry] of place.ambient.entries()) {
		if (!isObject(entry) || !isText(entry.cast)) {
			fault(`ambient ${i} names no cast member`);
			continue;
		}
		if (!isPoint(entry.at)) {
			fault(`ambient ${entry.cast} has no place (at)`);
			continue;
		}
		const what = `ambient ${entry.cast} ${fmt(entry.at)}`;
		const [x, y] = entry.at;
		if (x < 0 || y < 0 || x > place.cols || y > place.rows) fault(`${what} lies outside its grid`);
		else if (!isOpen(grid, entry.at)) fault(`${what} is not on open floor`);
		if (entry.face !== void 0 && ![
			"up",
			"down",
			"left",
			"right"
		].includes(entry.face)) fault(`${what} faces ${JSON.stringify(entry.face)}, not up, down, left, or right`);
		if (entry.stay !== void 0 && typeof entry.stay !== "boolean") fault(`${what} has a stay that is not true or false`);
		for (const [other, at, least] of clear) if (near(entry.at, at, least)) fault(`${what} is within ${least === 1 ? "a tile" : `${least} tiles`} of ${other}`);
		clear.push([
			`ambient ${entry.cast}`,
			entry.at,
			.9
		]);
	}
}
/** Rooms the world shows once per coordinator or per wing: a cast member there would stand in every copy. */
var REPEATING_ROOMS = [
	"headquarters",
	"common-room",
	"wing-small",
	"wing-large"
].map((name) => `places/${name}.json`);
/** Where the headquarters crew stands (in every coordinator's copy), and the looks it may wear. */
var CREW_ROOMS = ["headquarters", "common-room"].map((name) => `places/${name}.json`);
var CREW_LOOK_ROLES = ["townsfolk", "ambient"];
/**
* The cast against its places and looks: every member stands in exactly one place (one person, one place), every one
* standing is a member, each wears a look of the `ambient` role, and no two in one place wear the same look. The
* headquarters crew (`crew`) stands only in the headquarters or its common room, which repeat per coordinator, in an
* `ambient` or `townsfolk` look that no one outside the crew wears; everyone else stays out of rooms that repeat.
*/
function checkCastPlaced(manifest, looks, placed, problems) {
	const cast = isObject(manifest.ambient) ? manifest.ambient : {};
	const isCrew = (name) => isObject(cast[name]) && cast[name].crew === true;
	const lookOf = (name) => isObject(cast[name]) && isText(cast[name].look) ? cast[name].look : void 0;
	const first = /* @__PURE__ */ new Map();
	/** Who wears which look, per place file. */
	const wornIn = /* @__PURE__ */ new Map();
	for (const { file, cast: name } of placed) {
		if (!Object.hasOwn(cast, name)) {
			problems.push({
				file,
				fault: `ambient ${name} stands here, but theme.json's ambient does not name it`
			});
			continue;
		}
		if (isCrew(name) && !CREW_ROOMS.includes(file)) problems.push({
			file,
			fault: `ambient ${name} is headquarters crew, who stand only in the headquarters or its common room`
		});
		else if (!isCrew(name) && REPEATING_ROOMS.includes(file)) problems.push({
			file,
			fault: `ambient ${name} stands in a room the world shows once per coordinator or wing`
		});
		const look = lookOf(name);
		const other = look && wornIn.get(`${file}|${look}`);
		if (other && other !== name) problems.push({
			file,
			fault: `ambient ${name} wears ${look}, as ${other} here does: one look per person in a place`
		});
		else if (look) wornIn.set(`${file}|${look}`, name);
		const before = first.get(name);
		if (before === void 0) first.set(name, file);
		else if (before !== file) problems.push({
			file,
			fault: `ambient ${name} stands here and in ${before}: one person, one place`
		});
		else problems.push({
			file,
			fault: `ambient ${name} stands here twice: one person, one place`
		});
	}
	const fault = (text) => problems.push({
		file: "theme.json",
		fault: text
	});
	for (const name of Object.keys(cast)) if (!first.has(name)) fault(`ambient.${name} stands in no place`);
	if (isObject(looks)) checkCastLooks(cast, looks, isCrew, fault);
}
/** Each cast member's look: an `ambient` one, or for the crew a townsperson's too, never one the rest of the cast wears. */
function checkCastLooks(cast, looks, isCrew, fault) {
	const town = /* @__PURE__ */ new Map();
	for (const [name, member] of Object.entries(cast)) if (!isCrew(name) && isObject(member) && isText(member.look) && !town.has(member.look)) town.set(member.look, name);
	for (const [name, member] of Object.entries(cast)) {
		if (!isObject(member) || !isText(member.look)) continue;
		const look = looks[member.look];
		const crew = isCrew(name);
		if (!isObject(look)) fault(`ambient.${name} wears ${member.look}, which looks.json does not name`);
		else if (crew && !CREW_LOOK_ROLES.includes(String(look.role))) fault(`ambient.${name} wears ${member.look}, which is not a townsfolk or ambient look`);
		else if (!crew && look.role !== "ambient") fault(`ambient.${name} wears ${member.look}, which is not an ambient look`);
		else if (crew && town.has(member.look)) fault(`ambient.${name} wears ${member.look}, which ambient.${town.get(member.look)} wears too`);
	}
}
/** Where each frame's feet are: the lowest drawn row, per frame. */
function feetRows(image, frameWidth, frames) {
	const alpha = image.alpha;
	const rows = [];
	for (let f = 0; f < frames; f++) {
		let lowest = -1;
		for (let y = image.height - 1; y >= 0 && lowest < 0; y--) {
			const row = y * image.width;
			for (let x = f * frameWidth; x < (f + 1) * frameWidth; x++) if (alpha[row + x] >= OPAQUE) {
				lowest = y;
				break;
			}
		}
		rows.push(lowest);
	}
	return rows;
}
function topRow(image, frameWidth, frame) {
	const alpha = image.alpha;
	for (let y = 0; y < image.height; y++) {
		const row = y * image.width;
		for (let x = frame * frameWidth; x < (frame + 1) * frameWidth; x++) if (alpha[row + x] >= OPAQUE) return y;
	}
	return -1;
}
async function checkLooks(reader, value, hosts, pixels, problems) {
	const file = "characters/looks.json";
	if (!isObject(value)) return problems.push({
		file,
		fault: "is not an object"
	});
	const looks = value;
	for (const [role, least] of Object.entries(LOOK_ROLES)) {
		const count = Object.values(looks).filter((look) => isObject(look) && look.role === role).length;
		if (count < least) problems.push({
			file,
			fault: `has ${count} ${role} looks; a pack needs at least ${least}`
		});
	}
	for (const host of hosts) if (!looks[host]) problems.push({
		file,
		fault: `has no look ${host}, which a place's host wears`
	});
	await Promise.all(Object.entries(looks).map(async ([name, look]) => {
		if (!isObject(look) || typeof look.role !== "string" || !isPoint(look.frame) || !isNumber(look.baseline)) return problems.push({
			file,
			fault: `look ${name} needs a role, a frame [w, h], and a baseline`
		});
		const [w, h] = look.frame;
		const sheetFile = `characters/${name}.png`;
		const sheet = await reader.image(sheetFile, pixels);
		if (!sheet) problems.push({
			file: sheetFile,
			fault: "is missing"
		});
		else if (sheet.width !== w * 16 || sheet.height !== h) problems.push({
			file: sheetFile,
			fault: `is ${sheet.width} x ${sheet.height} px, but 16 frames of ${w} x ${h} (looks.json) make ${w * 16} x ${h}`
		});
		else if (look.baseline <= 0 || look.baseline > h) problems.push({
			file,
			fault: `look ${name}'s baseline ${look.baseline} lies outside its ${h} px frame`
		});
		else if (sheet.alpha) {
			const off = feetRows(sheet, w, 16).map((row, frame) => ({
				frame,
				row
			})).filter(({ row }) => Math.abs(row + 1 - look.baseline) > BASELINE_TOLERANCE);
			if (off.length) problems.push({
				file: sheetFile,
				fault: `frames ${off.map((o) => o.frame).join(", ")} stand off the baseline ${look.baseline} (feet at rows ${off.map((o) => o.row + 1).join(", ")})`
			});
			const standing = look.baseline - topRow(sheet, w, 14);
			if (Math.abs(standing - 120) > HEIGHT_TOLERANCE) problems.push({
				file: sheetFile,
				fault: `stands ${standing} px tall in its standing frame (14), not 120`
			});
		}
		if (look.idle !== void 0) await checkIdle(reader, name, look.idle, pixels, problems);
		for (let i = 0; i < EXPRESSIONS.length; i++) {
			const portraitFile = `characters/${name}-portrait-${i}.png`;
			const portrait = await reader.image(portraitFile);
			if (!portrait) problems.push({
				file: portraitFile,
				fault: `is missing (the ${EXPRESSIONS[i]} portrait)`
			});
			else if (portrait.height !== 360) problems.push({
				file: portraitFile,
				fault: `is ${portrait.height} px tall, not 360`
			});
		}
	}));
}
/**
* Check the pack `id` read through `reader`: its manifest and skin, every place over its painting, every look's sheet
* and portraits, and the overlays it needs. `pixels` also checks each sheet's frames stand on its baseline at the
* standing height (it reads every sheet's pixels). Returns every problem found, in a stable order; none means good.
*/
/** The skin's stylesheet: there, styling every class a skin must, and naming only files the pack has. */
async function checkSkin(reader, manifest, problems) {
	const skin = within("", manifest.skin);
	const css = skin && await reader.text(skin);
	if (!skin || css === void 0) return problems.push({
		file: manifest.skin,
		fault: "is missing (the skin)"
	});
	const dir = skin.split("/").slice(0, -1).join("/");
	const unstyled = SKIN_CLASSES.filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(css));
	if (unstyled.length) problems.push({
		file: skin,
		fault: `does not style ${unstyled.map((c) => `.${c}`).join(", ")}`
	});
	for (const ref of urls(css)) {
		const asset = within(dir, ref);
		if (!asset || await reader.text(asset) === void 0) problems.push({
			file: skin,
			fault: `names ${ref}, which is not in the pack`
		});
	}
	for (const [token, value] of Object.entries(isObject(manifest.style) ? manifest.style : {})) for (const ref of typeof value === "string" ? urls(value) : []) {
		const asset = within("", ref);
		if (!asset || await reader.text(asset) === void 0) problems.push({
			file: "theme.json",
			fault: `style ${token} names ${ref}, which is not in the pack`
		});
	}
}
/** Every place over its painting; returns the looks its hosts wear and the kinds of overlay slot it has. */
async function checkPlaces(reader, problems) {
	const hosts = [];
	/** Each place's host look, by place. */
	const hostOf = {};
	/** The look each place's recruiter names, by place. */
	const recruiterOf = {};
	const slotKinds = /* @__PURE__ */ new Set();
	/** The kinds of fidget object placed, and the first place file placing each. */
	const fidgets = /* @__PURE__ */ new Map();
	const pets = [];
	const cast = [];
	for (const name of PLACE_FILES) {
		const file = `places/${name}.json`;
		const place = await json(reader, file, problems);
		if (place === void 0) continue;
		if (!isObject(place) || typeof place.painting !== "string") {
			problems.push({
				file,
				fault: "names no painting"
			});
			checkPlace(name, place, void 0, problems);
			continue;
		}
		const painting = await reader.image(`places/${place.painting}`);
		if (!painting) problems.push({
			file: `places/${place.painting}`,
			fault: `is missing (the painting of ${name})`
		});
		checkPlace(name, place, painting, problems);
		const data = place;
		if (isObject(data.host) && typeof data.host.look === "string") {
			hosts.push(data.host.look);
			hostOf[name] = data.host.look;
		}
		if (Array.isArray(data.ambient)) {
			for (const entry of data.ambient) if (isObject(entry) && isText(entry.cast)) cast.push({
				file,
				cast: entry.cast
			});
		}
		if (isObject(data.recruiter) && typeof data.recruiter.look === "string") {
			hosts.push(data.recruiter.look);
			recruiterOf[name] = data.recruiter.look;
		}
		for (const slot of Array.isArray(data.overlaySlots) ? data.overlaySlots : []) {
			if (!isObject(slot)) continue;
			slotKinds.add(String(slot.kind));
			if (slot.kind === "fidget" && isFidget(slot.fidget) && !fidgets.has(slot.fidget)) fidgets.set(slot.fidget, file);
			if (slot.kind === "fidget" && (slot.fidget === "pet" || slot.fidget === "sleeper")) pets.push({
				file,
				slot
			});
		}
	}
	return {
		hosts,
		hostOf,
		recruiterOf,
		slotKinds,
		fidgets,
		pets,
		cast
	};
}
/**
* Check the pack `id` read through `reader`: its manifest and skin, every place over its painting, every look's sheet
* and portraits, and the overlays it needs. `pixels` also checks each sheet's frames stand on its baseline at the
* standing height (it reads every sheet's pixels). Returns every problem found, in a stable order; none means good.
*/
async function checkPack(reader, id, { pixels = true } = {}) {
	const problems = [];
	const manifest = checkManifest(await json(reader, "theme.json", problems), id, problems);
	if (manifest && typeof manifest.skin === "string") await checkSkin(reader, manifest, problems);
	const { hosts, hostOf, recruiterOf, slotKinds, fidgets, pets, cast } = await checkPlaces(reader, problems);
	const looks = await json(reader, "characters/looks.json", problems);
	if (looks !== void 0) await checkLooks(reader, looks, hosts, pixels, problems);
	if (manifest) checkCastPlaced(manifest, looks, cast, problems);
	for (const [place, look] of Object.entries(hostOf)) {
		const role = PLACE_NEEDS[place]?.host;
		const worn = isObject(looks) && isObject(looks[look]) ? looks[look].role : void 0;
		if (role && worn !== void 0 && worn !== role) problems.push({
			file: `places/${place}.json`,
			fault: `its host wears ${look}, which is not a ${role} look`
		});
	}
	for (const [place, look] of Object.entries(recruiterOf)) {
		const worn = isObject(looks) && isObject(looks[look]) ? looks[look].role : void 0;
		if (worn !== void 0 && worn !== "recruiter") problems.push({
			file: `places/${place}.json`,
			fault: `its recruiter wears ${look}, which is not a recruiter look`
		});
	}
	if (slotKinds.has("bed") && manifest && isObject(manifest.world) && manifest.world.bed === void 0) problems.push({
		file: "theme.json",
		fault: "has no world.bed, which its places' bed slots need"
	});
	const styles = manifest && isObject(manifest.fidgets) ? manifest.fidgets : {};
	for (const [kind, place] of fidgets) if (manifest && !isObject(styles[kind])) problems.push({
		file: "theme.json",
		fault: `has no fidgets.${kind}, which ${place} places`
	});
	const overlays = [
		...REQUIRED_OVERLAYS,
		...[...slotKinds].flatMap((kind) => SLOT_OVERLAYS[kind] ?? []),
		...[...fidgets.keys()].flatMap((kind) => kind === "pet" ? [] : FIDGETS[kind].art),
		...checkPets(pets, styles.pet, problems)
	];
	for (const name of new Set(overlays)) {
		const file = `overlays/${name}.png`;
		if (!await reader.image(file)) problems.push({
			file,
			fault: "is missing"
		});
	}
	return problems.sort((a, b) => a.file.localeCompare(b.file) || a.fault.localeCompare(b.fault));
}
//#endregion
//#region apps/agent-world/src/backend/theme-packs.ts
var SIGNATURE = Buffer.from([
	137,
	80,
	78,
	71,
	13,
	10,
	26,
	10
]);
function paeth(a, b, c) {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Undo each scanline's PNG filter, handing every row of samples to `row` in order. */
function unfilter(raw, width, height, channels, row) {
	const stride = width * channels;
	const current = new Uint8Array(stride);
	let previous = new Uint8Array(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let i = 0; i < stride; i++) {
			const left = i >= channels ? current[i - channels] : 0;
			const up = previous[i];
			const corner = i >= channels ? previous[i - channels] : 0;
			const predicted = filter === 1 ? left : filter === 2 ? up : filter === 3 ? left + up >> 1 : filter === 4 ? paeth(left, up, corner) : 0;
			current[i] = line[i] + predicted;
		}
		row(y, current);
		previous = Uint8Array.from(current);
	}
}
/** A PNG's size, and with `pixels` its alpha channel; undefined when the file is not a PNG it can read. */
function readPng(data, pixels = false) {
	if (data.length < 33 || !data.subarray(0, 8).equals(SIGNATURE) || data.toString("latin1", 12, 16) !== "IHDR") return void 0;
	const width = data.readUInt32BE(16);
	const height = data.readUInt32BE(20);
	if (!pixels) return {
		width,
		height
	};
	const depth = data[24];
	const colour = data[25];
	const interlaced = data[28] !== 0;
	const channels = {
		0: 1,
		2: 3,
		3: 1,
		4: 2,
		6: 4
	}[colour];
	if (depth !== 8 || interlaced || channels === void 0) return void 0;
	const idat = [];
	let transparency;
	for (let at = 8; at + 8 <= data.length;) {
		const length = data.readUInt32BE(at);
		const type = data.toString("latin1", at + 4, at + 8);
		const body = data.subarray(at + 8, at + 8 + length);
		if (type === "IDAT") idat.push(body);
		if (type === "tRNS") transparency = body;
		if (type === "IEND") break;
		at += 12 + length;
	}
	let raw;
	try {
		raw = inflateSync(Buffer.concat(idat));
	} catch {
		return;
	}
	const stride = width * channels;
	if (raw.length < height * (stride + 1)) return void 0;
	const alpha = new Uint8Array(width * height);
	unfilter(raw, width, height, channels, (y, line) => {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			if (colour === 6) alpha[index] = line[x * 4 + 3];
			else if (colour === 4) alpha[index] = line[x * 2 + 1];
			else if (colour === 3) alpha[index] = transparency?.[line[x]] ?? 255;
			else alpha[index] = 255;
		}
	});
	return {
		width,
		height,
		alpha
	};
}
/** A reader over a pack's directory: paths stay inside it. */
function packReader(dir) {
	const file = (path) => {
		const full = normalize(join(dir, path));
		if (!full.startsWith(normalize(dir) + sep) || !existsSync(full) || !statSync(full).isFile()) return void 0;
		return full;
	};
	return {
		async text(path) {
			const full = file(path);
			return full ? readFileSync(full, "utf8") : void 0;
		},
		async image(path, pixels) {
			const full = file(path);
			return full ? readPng(readFileSync(full), pixels) : void 0;
		}
	};
}
/** Check the pack in `dir`, named by its directory. */
function checkThemePack(dir, options) {
	const id = normalize(dir).split(sep).filter(Boolean).pop() ?? "";
	return checkPack(packReader(dir), id, options);
}
/** The window's colour when no pack's backdrop can be read: a neutral dark near every theme's own. */
var NEUTRAL_BACKDROP = "#121216";
/**
* The colour the window shows before the page draws (and around it while it resizes): the backdrop (`world.backdrop`,
* a `#rrggbb` colour) of the theme `id`, else of the pack the world opens in by default, else a neutral dark.
*/
function themeBackdrop(themesDir, id) {
	for (const each of [id, "fantasy"]) {
		if (!each || !/^[a-z0-9][a-z0-9-]*$/.test(each)) continue;
		try {
			const backdrop = JSON.parse(readFileSync(join(themesDir, each, "theme.json"), "utf8")).world?.backdrop;
			if (typeof backdrop === "string" && /^#[0-9a-f]{6}$/i.test(backdrop)) return backdrop;
		} catch {}
	}
	return NEUTRAL_BACKDROP;
}
/** Every pack under `themesDir` (a directory with a theme.json), checked, in name order with fantasy first. */
async function listThemes(themesDir, options) {
	const ids = existsSync(themesDir) ? readdirSync(themesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(themesDir, entry.name, "theme.json"))).map((entry) => entry.name).sort((a, b) => a === "fantasy" ? -1 : b === "fantasy" ? 1 : a.localeCompare(b)) : [];
	return Promise.all(ids.map(async (id) => {
		const problems = await checkThemePack(join(themesDir, id), options);
		let name = id;
		let description = null;
		try {
			const manifest = JSON.parse(readFileSync(join(themesDir, id, "theme.json"), "utf8"));
			if (typeof manifest.name === "string") name = manifest.name;
			if (typeof manifest.description === "string") description = manifest.description;
		} catch {}
		return {
			id,
			name,
			description,
			problems
		};
	}));
}
/** New events of `FEED_TYPES` after a sequence number, with their session's name; `?` is the last seq read. */
var FEED_SINCE = `select e.seq, e.at, e.session_id as sessionId, e.generation, e.type, e.data,
	s.name, s.cwd, s.kind as sessionKind
from events e left join sessions s on s.id = e.session_id
where e.seq > ? and e.type in (${[
	"incarnation_started",
	"incarnation_ended",
	"run_state",
	"prompt_opened",
	"prompt_closed",
	"command_accepted",
	"command_applied",
	"command_failed"
].map((type) => `'${type}'`).join(", ")})
order by e.seq limit 500`;
/** How a command reads in a line, as "<label> for <name>". Commands the views send for themselves have none. */
var LABELS = {
	talk: "Message",
	steer: "Redirect",
	follow_up: "Follow-up",
	abort: "Stop",
	close: "Close",
	answer: "Answer",
	rename: "Rename",
	set_model: "Model change",
	set_thinking: "Thinking change",
	start: "Start"
};
var PREVIEW$2 = 120;
function preview$2(text) {
	const flat = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
	return flat.length > PREVIEW$2 ? `${flat.slice(0, 119)}\u2026` : flat;
}
function parse$2(json) {
	if (!json) return {};
	try {
		const value = JSON.parse(json);
		return value && typeof value === "object" ? value : {};
	} catch {
		return {};
	}
}
/** What a command says beyond its label: the text it carries. */
function detail(command) {
	if (command.kind === "rename") return preview$2(command.name);
	if (command.kind === "set_model") return preview$2(command.id);
	if (command.kind === "set_thinking") return preview$2(command.level);
	return preview$2(command.text ?? command.prompt);
}
/** The line for one event, or undefined when it is not one the operator follows. */
function feedLine(row, lookup) {
	if (row.sessionKind === "child") return void 0;
	const name = row.name || (row.cwd ? basename(row.cwd) : null) || row.sessionId;
	const data = parse$2(row.data);
	const line = (kind, text) => ({
		seq: row.seq,
		at: row.at,
		kind,
		character: row.sessionId,
		name,
		text
	});
	switch (row.type) {
		case "incarnation_started": return line("agents", (row.generation ?? 1) > 1 ? `${name} started again.` : `${name} started.`);
		case "incarnation_ended":
			if (data.reason === "superseded") return void 0;
			return line("agents", `${name} stopped${typeof data.reason === "string" ? ` (${data.reason})` : ""}.`);
		case "run_state": return data.to === "idle" && data.from !== "compacting" ? line("agents", `${name} finished its turn.`) : void 0;
		case "prompt_opened": {
			const prompt = data.to ?? {};
			const first = Array.isArray(prompt.questions) ? prompt.questions[0] : void 0;
			const asks = preview$2(prompt.title ?? first?.question);
			return line("agents", asks ? `${name} asks: ${asks}` : `${name} asks you something.`);
		}
		case "prompt_closed": return line("agents", `${name}'s question was answered.`);
		case "command_accepted": {
			const command = data.command ?? {};
			if (command.kind === "mail") return line("mail", `Mail from ${command.from === "operator" ? "you" : typeof command.from === "string" ? lookup.name(command.from) ?? command.from : "someone"} to ${name}: ${preview$2(command.body)}`);
			const label = LABELS[String(command.kind)];
			if (!label) return void 0;
			const said = detail(command);
			return line("commands", said ? `${label} for ${name}: ${said}` : `${label} for ${name}.`);
		}
		case "command_applied":
		case "command_failed": {
			const command = typeof data.commandId === "string" ? lookup.command(data.commandId) : void 0;
			const label = command ? LABELS[command.kind] : void 0;
			if (!label) return void 0;
			if (row.type === "command_failed") return line("commands", `${label} for ${name} failed: ${preview$2(data.reason) || "no reason given"}.`);
			return command?.kind === "start" ? void 0 : line("commands", `${name} took the ${label.toLowerCase()}.`);
		}
	}
}
var MAIL = `select m.id, m.sender, m.receiver, m.body, m.sent_at as sentAt, m.delivered_at as deliveredAt, m.stage,
	m.reason, fs.name as fromName, fs.cwd as fromCwd, ts.name as toName, ts.cwd as toCwd
from mail m
left join sessions fs on fs.id = m.sender
left join sessions ts on ts.id = m.receiver
where m.id in (select id from mail order by sent_at desc limit 120)
	or m.stage in ('accepted', 'delivered')
order by m.sent_at desc, m.id`;
var nameOf = (id, name, cwd) => name || (cwd ? cwd.split("/").filter(Boolean).pop() : void 0) || id;
/** The mail the world shows now. */
function readMail(db) {
	return db.prepare(MAIL).all().map((row) => {
		const from = row.sender ?? "someone";
		const body = row.body ?? "";
		return {
			id: row.id,
			from,
			fromName: from === "operator" ? "You" : nameOf(from, row.fromName, row.fromCwd),
			to: row.receiver,
			toName: nameOf(row.receiver, row.toName, row.toCwd),
			body: body.length > 4e3 ? `${body.slice(0, MAIL_BODY_MAX - 1)}\u2026` : body,
			sentAt: row.sentAt,
			deliveredAt: row.deliveredAt,
			state: row.stage === "applied" ? "delivered" : row.stage === "failed" ? "failed" : "waiting",
			reason: row.reason
		};
	});
}
//#endregion
//#region apps/agent-world/src/backend/projection.ts
var byStart = (a, b) => (a.firstStartedAt ?? Number.MAX_SAFE_INTEGER) - (b.firstStartedAt ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/**
* A coordinator was started with `--coordinator` or has a session reporting to it; a worker reports to one; any
* other session is independent. Each awake coordinator, and each coordinator with an awake worker, has a
* headquarters. Workers stand in the wing of their repository, or the common room outside one; independents stand
* in the square. Dormant sessions sleep at the inn, the most recently stopped first, each in the role it had.
*/
function projectWorld(sessions, remembered) {
	const byId = new Map(sessions.map((session) => [session.id, session]));
	const coordinators = /* @__PURE__ */ new Set();
	for (const session of sessions) {
		if (session.coordinatorFlag) coordinators.add(session.id);
		if (session.reportsTo && session.reportsTo !== session.id) coordinators.add(session.reportsTo);
	}
	const roleOf = (session) => coordinators.has(session.id) ? "coordinator" : session.reportsTo && coordinators.has(session.reportsTo) ? "worker" : "independent";
	const nameOf = (session) => session.name || basename(session.cwd) || session.id;
	const dormant = sessions.filter((session) => !session.awake).sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0) || byStart(b, a)).map((session) => ({
		id: session.id,
		name: nameOf(session),
		role: roleOf(session),
		startedAt: session.firstStartedAt ?? 0,
		stoppedAt: session.stoppedAt ?? null
	}));
	const characters = sessions.filter((session) => session.awake).sort(byStart).map((session) => {
		let role;
		let place;
		if (coordinators.has(session.id)) {
			role = "coordinator";
			place = {
				kind: "headquarters",
				headquarters: session.id
			};
		} else if (session.reportsTo && coordinators.has(session.reportsTo)) {
			role = "worker";
			place = session.repository ? {
				kind: "wing",
				headquarters: session.reportsTo,
				repository: session.repository
			} : {
				kind: "common-room",
				headquarters: session.reportsTo
			};
		} else {
			role = "independent";
			place = { kind: "square" };
		}
		return {
			id: session.id,
			name: nameOf(session),
			role,
			place,
			startedAt: session.firstStartedAt ?? 0
		};
	});
	const shown = /* @__PURE__ */ new Set();
	for (const { place } of characters) if (!isOutside(place)) shown.add(place.headquarters);
	const order = [...shown].map((id) => ({
		id,
		firstStartedAt: byId.get(id)?.firstStartedAt
	})).sort(byStart).map(({ id }) => id);
	const wings = {};
	return {
		headquarters: order.map((id) => {
			const workers = characters.filter((character) => character.place.kind === "wing" && character.place.headquarters === id);
			const list = [...remembered[id] ?? []];
			for (const worker of workers) {
				const { repository } = worker.place;
				if (!list.includes(repository)) list.push(repository);
			}
			wings[id] = list;
			const coordinator = byId.get(id);
			return {
				id,
				name: coordinator ? coordinator.name || basename(coordinator.cwd) || id : id,
				wings: list.map((repository) => ({
					repository,
					name: basename(repository) || repository,
					headcount: workers.filter((worker) => worker.place.repository === repository).length,
					dormant: sessions.filter((session) => !session.awake && session.reportsTo === id && session.repository === repository).length
				}))
			};
		}),
		characters,
		wings,
		dormant
	};
}
//#endregion
//#region apps/agent-world/src/backend/terminal.ts
var run = promisify(execFile);
var TMUX_TIMEOUT_MS = 2e3;
async function tmux(socket, args) {
	const { stdout } = await run("tmux", [
		"-S",
		socket,
		...args
	], {
		timeout: TMUX_TIMEOUT_MS,
		encoding: "utf8"
	});
	return stdout;
}
/** Switch the most recently active client of the server at `socket` to `pane`; `name` is the character's. */
async function switchToPane(socket, pane, name) {
	let clients;
	try {
		clients = (await tmux(socket, [
			"list-clients",
			"-F",
			"#{client_tty}	#{client_activity}"
		])).split("\n").filter(Boolean).map((line) => {
			const [tty, activity] = line.split("	");
			return {
				tty,
				activity: Number(activity) || 0
			};
		});
	} catch {
		clients = [];
	}
	const client = clients.sort((a, b) => b.activity - a.activity)[0];
	if (!client) return {
		ok: false,
		reason: `No terminal is attached to ${name}'s tmux server.`
	};
	try {
		await tmux(socket, [
			"switch-client",
			"-c",
			client.tty,
			"-t",
			pane
		]);
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			reason: `tmux could not switch to ${name}'s pane: ${error.stderr?.trim() || error.message}`
		};
	}
}
//#endregion
//#region apps/agent-world/src/backend/world-backend.ts
/**
* Turns each published snapshot into the update one receiver (the window) is sent: the inn and the mail are left out
* while they are the same arrays as in the snapshot before, which `publish` keeps them as while unchanged.
*/
function leaveOutUnchanged() {
	const sent = {};
	return (snapshot) => {
		const update = { ...snapshot };
		const unchanged = [];
		for (const part of ["dormant", "mail"]) if (part in sent && sent[part] === snapshot[part]) {
			delete update[part];
			unchanged.push(part);
		} else sent[part] = snapshot[part];
		if (unchanged.length) update.unchanged = unchanged;
		return update;
	};
}
/** How often new `events` rows are looked for; updates must reach the world within a second. */
var POLL_MS$1 = 200;
var RECONNECT_MS = 1e3;
/** Polls between rereads of the world while no event arrives, so edited `task.md` files show. */
var TASK_REREAD_POLLS = 10;
/** Polls between reads of every session row; between them only the rows events name (and awake ones) are read. */
var FULL_REREAD_POLLS = 150;
var FEED_BACKLOG_EVENTS = 5e3;
/** After a failed preference write, wait this long before sending it again. */
var RETRY_MS = 5e3;
/** How long choosing a look waits for the runtime to store it. */
var STORE_TIMEOUT_MS = 5e3;
/**
* The `preferences` key Agent World keeps its choices under:
* `{ wings: { [coordinator id]: repository[] }, avatar: look, theme: id }`.
*/
var PREFERENCE_KEY = "agent-world";
var sessionsSql = (intent) => `
select s.id, s.name, s.cwd, s.reports_to as reportsTo, s.git, s.config,
	(select min(f.started_at) from incarnations f where f.session_id = s.id) as firstStartedAt,
	coalesce(i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost'), 0) as awake,
	i.ended_at as stoppedAt, i.end_reason as stopReason,
	${factsColumns(intent)}
from sessions s
${FACTS_JOINS}
where s.kind = 'root'`;
var changedSql = (intent) => `${sessionsSql(intent)}
	and s.id in (select session_id from events where seq > ? union select value from json_each(?))`;
var SESSIONS = [sessionsSql(false), sessionsSql(true)];
var CHANGED_SESSIONS = [changedSql(false), changedSql(true)];
var INTENT_COLUMN = "select 1 from pragma_table_info('sessions') where name = 'intent'";
function parse$1(json) {
	if (!json) return void 0;
	try {
		return JSON.parse(json);
	} catch {
		return;
	}
}
function sessionRow(row) {
	const git = parseShared(row.git);
	const config = parseShared(row.config);
	return {
		id: row.id,
		name: row.name,
		cwd: row.cwd,
		reportsTo: row.reportsTo,
		repository: typeof git?.repository === "string" ? git.repository : null,
		coordinatorFlag: Array.isArray(config?.flags) && config.flags.includes("coordinator"),
		awake: row.awake === 1,
		firstStartedAt: row.firstStartedAt ?? void 0,
		stoppedAt: row.stoppedAt ?? void 0
	};
}
/** Each coordinator's wings: those in `first`, then any in `then` not among them, in order. */
function mergeWings(first, then) {
	const merged = {};
	for (const id of /* @__PURE__ */ new Set([...Object.keys(first), ...Object.keys(then)])) merged[id] = [.../* @__PURE__ */ new Set([...first[id] ?? [], ...then[id] ?? []])];
	return merged;
}
/** The operator's choices kept in the preference beside the wings. */
var CHOICES = ["avatar", "theme"];
function openWorldBackend(paths) {
	const listeners = /* @__PURE__ */ new Set();
	let current = {
		connected: false,
		headquarters: [],
		characters: []
	};
	let world;
	let dormant = [];
	let mail = [];
	let db;
	let socket;
	let socketOpen = false;
	let lastSeq = -1;
	const rowsById = /* @__PURE__ */ new Map();
	const sessionsById = /* @__PURE__ */ new Map();
	let rowsSeq = -1;
	let closed = false;
	let seen = {};
	let sending;
	const chosen = {};
	const stored = {
		avatar: null,
		theme: null
	};
	const waiters = /* @__PURE__ */ new Set();
	const settle = (key, result) => {
		for (const waiter of waiters) if (key === void 0 || waiter.key === key) {
			waiter.done(result);
			waiters.delete(waiter);
		}
	};
	let retryAt = 0;
	const readTask = taskReader();
	let polls = 0;
	const feedListeners = /* @__PURE__ */ new Set();
	let recent = [];
	let feedSeq;
	let currentJson = JSON.stringify(current);
	const publish = (next) => {
		const json = JSON.stringify({
			...next,
			dormant: void 0,
			mail: void 0
		});
		const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
		if (json === currentJson && same(next.dormant, current.dormant) && same(next.mail, current.mail)) return;
		currentJson = json;
		current = next;
		for (const listener of listeners) listener(current);
	};
	const openDb = () => {
		if (db || !existsSync(paths.db)) return;
		db = new DatabaseSync(paths.db);
		db.exec("pragma query_only = 1");
		lastSeq = -1;
		rowsSeq = -1;
	};
	const dropDb = () => {
		db?.close();
		db = void 0;
	};
	const storedPreference = (database) => {
		const value = parse$1(database.prepare("select value from preferences where key = ?").get(PREFERENCE_KEY)?.value);
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	};
	/**
	* Send the wings, the chosen avatar look, and the chosen theme to the runtime when they differ from what it stored,
	* keeping the preference's other keys.
	*/
	const remember = (preference, storedWings, wings) => {
		const next = mergeWings(storedWings, wings);
		for (const key of CHOICES) {
			const value = preference[key];
			stored[key] = typeof value === "string" ? value : null;
			if (chosen[key] !== void 0 && chosen[key] === stored[key]) {
				delete chosen[key];
				settle(key, { ok: true });
			}
		}
		if (JSON.stringify(next) === JSON.stringify(storedWings) && !Object.keys(chosen).length) {
			sending = void 0;
			return;
		}
		const value = {
			...preference,
			wings: next,
			...chosen
		};
		const json = JSON.stringify(value);
		if (!socket || !socketOpen || json === sending?.value || Date.now() < retryAt) return;
		const commandId = `agent-world-${randomUUID()}`;
		sending = {
			commandId,
			value: json
		};
		const command = {
			kind: "set_preference",
			key: PREFERENCE_KEY,
			value
		};
		socket.write(`${JSON.stringify({
			type: "command",
			commandId,
			sessionId: "agent-world",
			command
		})}\n`);
	};
	/** `rereadTasks`: check the sleepers' task files for changes too (awake characters' are checked on every read). */
	const read = (rereadTasks) => {
		openDb();
		if (!db) return void 0;
		try {
			const { seq } = db.prepare("select coalesce(max(seq), 0) as seq from events").get();
			if (seq === lastSeq && world) return world;
			lastSeq = seq;
			const full = rowsSeq < 0 || seq < rowsSeq || polls % FULL_REREAD_POLLS === 0;
			const awakeIds = [...sessionsById.values()].filter((session) => session.awake).map((session) => session.id);
			const intent = Number(db.prepare(INTENT_COLUMN).get() !== void 0);
			const changed = full ? db.prepare(SESSIONS[intent]).all() : db.prepare(CHANGED_SESSIONS[intent]).all(rowsSeq, JSON.stringify(awakeIds));
			if (full) {
				rowsById.clear();
				sessionsById.clear();
			}
			for (const row of changed) {
				rowsById.set(row.id, row);
				sessionsById.set(row.id, sessionRow(row));
			}
			rowsSeq = seq;
			const preference = storedPreference(db);
			const storedWings = preference.wings && typeof preference.wings === "object" ? preference.wings : {};
			const projected = projectWorld([...sessionsById.values()], mergeWings(storedWings, seen));
			const byId = rowsById;
			world = {
				...projected,
				characters: projected.characters.map((character) => ({
					...character,
					facts: factsOf(byId.get(character.id), readTask)
				}))
			};
			dormant = dormantAgents(world.dormant, byId, (task) => readTask(task, rereadTasks), dormant, !rereadTasks);
			const nextMail = readMail(db);
			if (JSON.stringify(nextMail) !== JSON.stringify(mail)) mail = nextMail;
			seen = mergeWings(seen, world.wings);
			remember(preference, storedWings, world.wings);
			return world;
		} catch {
			dropDb();
			return;
		}
	};
	/** New feed lines since the last read; the first read starts with a short backlog. */
	const readFeed = () => {
		if (!db) return;
		const database = db;
		try {
			const { seq } = database.prepare("select coalesce(max(seq), 0) as seq from events").get();
			if (feedSeq === void 0 || seq < feedSeq) feedSeq = Math.max(0, seq - FEED_BACKLOG_EVENTS);
			if (seq === feedSeq) return;
			const lookup = {
				command(commandId) {
					const row = database.prepare("select kind, command from commands where command_id = ?").get(commandId);
					return row ? {
						kind: row.kind,
						command: parse$1(row.command) ?? {}
					} : void 0;
				},
				name(sessionId) {
					const row = database.prepare("select name, cwd from sessions where id = ?").get(sessionId);
					return row ? row.name || row.cwd.split("/").pop() || sessionId : void 0;
				}
			};
			const backlog = recent.length === 0;
			const lines = [];
			for (;;) {
				const rows = database.prepare(FEED_SINCE).all(feedSeq);
				for (const row of rows) {
					const line = feedLine(row, lookup);
					if (line) lines.push(line);
				}
				feedSeq = rows.at(-1)?.seq ?? seq;
				if (rows.length < 500) break;
			}
			feedSeq = Math.max(feedSeq, seq);
			const fresh = backlog ? lines.slice(-60) : lines;
			if (!fresh.length) return;
			recent = [...recent, ...fresh].slice(-200);
			for (const listener of feedListeners) listener(fresh);
		} catch {
			dropDb();
		}
	};
	const poll = () => {
		if (closed) return;
		const rereadTasks = ++polls % TASK_REREAD_POLLS === 0;
		if (rereadTasks) lastSeq = -1;
		const next = read(rereadTasks);
		readFeed();
		publish({
			connected: socketOpen && next !== void 0,
			headquarters: next?.headquarters ?? current.headquarters,
			characters: next?.characters ?? current.characters,
			avatarLook: chosen.avatar ?? stored.avatar,
			theme: chosen.theme ?? stored.theme,
			dormant,
			mail
		});
	};
	const onLine = (line) => {
		const message = parse$1(line);
		if (message?.type !== "receipt" || message.commandId !== sending?.commandId || message.stage !== "failed") return;
		console.error(`agent-world: the runtime did not store the preference: ${message.reason ?? "no reason given"}`);
		sending = void 0;
		settle(void 0, {
			ok: false,
			reason: `The runtime did not store it: ${message.reason ?? "no reason given"}.`
		});
		retryAt = Date.now() + RETRY_MS;
		retry = setTimeout(() => {
			lastSeq = -1;
		}, RETRY_MS).unref();
	};
	let reconnect;
	let retry;
	const connect = () => {
		if (closed) return;
		const next = createConnection(paths.socket);
		socket = next;
		let buffer = "";
		next.on("data", (chunk) => {
			buffer += chunk.toString();
			for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				if (line.trim()) onLine(line);
			}
		});
		next.on("connect", () => {
			socketOpen = true;
			sending = void 0;
			lastSeq = -1;
			rowsSeq = -1;
			poll();
		});
		next.on("error", () => {});
		next.on("close", () => {
			socketOpen = false;
			poll();
			if (!closed) reconnect = setTimeout(connect, RECONNECT_MS).unref();
		});
	};
	connect();
	const timer = setInterval(poll, POLL_MS$1).unref();
	poll();
	/** Keep a choice: the snapshot shows it at once; resolves once the runtime stored it (or why not). */
	const choose = (key, value) => {
		chosen[key] = value;
		const storing = new Promise((resolve) => {
			let timer;
			const waiter = {
				key,
				done(result) {
					clearTimeout(timer);
					resolve(result);
				}
			};
			timer = setTimeout(() => {
				waiters.delete(waiter);
				resolve({
					ok: false,
					reason: "The session runtime did not store it yet; it will when it answers."
				});
			}, STORE_TIMEOUT_MS);
			waiters.add(waiter);
		});
		lastSeq = -1;
		poll();
		return storing;
	};
	return {
		snapshot: () => current,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		feed: () => recent,
		async goToTerminal(characterId) {
			const character = current.characters.find((c) => c.id === characterId);
			if (!character) return {
				ok: false,
				reason: "No such character is awake."
			};
			const pane = character.facts?.tmux;
			if (!pane) return {
				ok: false,
				reason: `${character.name} is not running in tmux.`
			};
			return switchToPane(pane.socket, pane.pane, character.name);
		},
		subscribeFeed(listener) {
			feedListeners.add(listener);
			return () => feedListeners.delete(listener);
		},
		setAvatarLook: (look) => choose("avatar", look),
		setTheme: (id) => choose("theme", id),
		close() {
			closed = true;
			settle(void 0, {
				ok: false,
				reason: "Agent World closed before the runtime stored it."
			});
			clearInterval(timer);
			clearTimeout(reconnect);
			clearTimeout(retry);
			socket?.destroy();
			dropDb();
			listeners.clear();
			feedListeners.clear();
		}
	};
}
//#endregion
//#region apps/agent-world/src/backend/integrations/atlassian.ts
var TIMEOUT_MS$2 = 2e4;
/**
* The site's origin from what the operator typed: `acme`, `acme.atlassian.net`, or a full address. Plain http is
* allowed only on loopback (the tests' fake servers); undefined when it is no usable address.
*/
function atlassianSite(site) {
	let text = site.trim().replace(/\/+$/, "");
	if (!text) return void 0;
	if (!/^[a-z]+:\/\//i.test(text)) text = text.includes(".") ? `https://${text}` : `https://${text}.atlassian.net`;
	let url;
	try {
		url = new URL(text);
	} catch {
		return;
	}
	const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
	if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return void 0;
	return url.origin;
}
var NOT_SIGNED_IN$1 = {
	ok: false,
	reason: "Sign in to Atlassian in Settings first.",
	signIn: "atlassian"
};
/** Call `path` on the site; non-2xx answers become a refusal that says what went wrong in plain words. */
async function atlassianRequest(credentials, path, options = {}) {
	if (!credentials) return NOT_SIGNED_IN$1;
	const auth = Buffer.from(`${credentials.email}:${credentials.token}`).toString("base64");
	let response;
	try {
		response = await (options.fetch ?? fetch)(`${credentials.site}${path}`, {
			method: options.method ?? "GET",
			headers: {
				Authorization: `Basic ${auth}`,
				Accept: "application/json",
				...options.body === void 0 ? {} : { "Content-Type": "application/json" }
			},
			body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
			signal: AbortSignal.timeout(TIMEOUT_MS$2)
		});
	} catch {
		return {
			ok: false,
			reason: `Could not reach ${new URL(credentials.site).host}.`
		};
	}
	const text = await response.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	if (response.ok) return {
		ok: true,
		status: response.status,
		json
	};
	if (response.status === 401) return {
		ok: false,
		reason: "Atlassian did not accept the email and API token; sign in again in Settings.",
		signIn: "atlassian"
	};
	return {
		ok: false,
		reason: atlassianError(response.status, json)
	};
}
/** Jira and Confluence error bodies (`errorMessages`, `errors`, `message`) as one sentence. */
function atlassianError(status, json) {
	const body = json ?? {};
	const messages = [
		...Array.isArray(body.errorMessages) ? body.errorMessages : [],
		...body.errors && typeof body.errors === "object" ? Object.values(body.errors) : [],
		...typeof body.message === "string" ? [body.message] : []
	].filter((message) => typeof message === "string" && message.length > 0);
	if (messages.length) return messages.join(" ");
	if (status === 403) return "Atlassian says you may not do that.";
	if (status === 404) return "Atlassian found nothing there.";
	return `Atlassian answered ${status}.`;
}
/** Quote text for a JQL or CQL string: Lucene's operators become spaces, quotes and backslashes are escaped. */
function queryText(text) {
	return text.replace(/[+\-&|!(){}[\]^~*?:/]/g, " ").replace(/[\\"]/g, "\\$&").replace(/\s+/g, " ").trim();
}
/** Plain text from HTML: tags dropped, common entities decoded, whitespace folded. */
function htmlText(html) {
	return html.replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();
}
//#endregion
//#region apps/agent-world/src/backend/integrations/credentials.ts
/** The files Agent World keeps beside the runtime's state. */
function integrationFiles(stateDir) {
	return {
		credentials: join(stateDir, "agent-world-credentials.json"),
		record: join(stateDir, "agent-world-outside-writes.jsonl"),
		recentPages: join(stateDir, "agent-world-library-recent.json")
	};
}
/** Write `text` to `file` readable by its owner only, replacing it whole. */
function writePrivate(file, text) {
	mkdirSync(dirname(file), {
		recursive: true,
		mode: 448
	});
	const temporary = `${file}.${process.pid}.tmp`;
	const fd = openSync(temporary, "w", 384);
	try {
		writeSync(fd, text);
	} finally {
		closeSync(fd);
	}
	chmodSync(temporary, 384);
	renameSync(temporary, file);
}
function openCredentials(file) {
	const read = () => {
		if (!existsSync(file)) return {};
		if ((statSync(file).mode & 63) !== 0) chmodSync(file, 384);
		try {
			const value = JSON.parse(readFileSync(file, "utf8"));
			return value && typeof value === "object" ? value : {};
		} catch {
			return {};
		}
	};
	return {
		read,
		set(account, value) {
			const next = {
				...read(),
				[account]: value
			};
			if (value === void 0) delete next[account];
			if (!next.atlassian && !next.slack) {
				rmSync(file, { force: true });
				return;
			}
			writePrivate(file, `${JSON.stringify(next, null, "	")}\n`);
		},
		status() {
			const { atlassian, slack } = read();
			return {
				atlassian: atlassian ? {
					site: atlassian.site,
					email: atlassian.email
				} : null,
				slack: slack ? {
					team: slack.team ?? null,
					url: slack.url ?? null,
					user: slack.user ?? null
				} : null
			};
		}
	};
}
//#endregion
//#region apps/agent-world/src/backend/integrations/confluence.ts
var SEARCH_MAX = 25;
var RECENT_MAX = 30;
function openConfluence(credentials, recentFile, fetchImpl, now = Date.now) {
	const request = (path) => atlassianRequest(credentials(), path, { fetch: fetchImpl });
	const wiki = () => `${credentials()?.site ?? ""}/wiki`;
	const spaceNames = /* @__PURE__ */ new Map();
	const recent = () => {
		if (!existsSync(recentFile)) return [];
		try {
			const value = JSON.parse(readFileSync(recentFile, "utf8"));
			return Array.isArray(value) ? value : [];
		} catch {
			return [];
		}
	};
	return {
		async search(text) {
			const words = queryText(text);
			if (!words) return {
				ok: true,
				pages: []
			};
			const cql = `siteSearch ~ "${words}" and type in (page, blogpost) order by lastmodified desc`;
			const answer = await request(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${SEARCH_MAX}`);
			if (!answer.ok) return answer;
			const body = answer.json ?? {};
			const base = body._links?.base ?? wiki();
			return {
				ok: true,
				pages: (body.results ?? []).flatMap((raw) => {
					const result = raw;
					const id = result.content?.id;
					if (!id) return [];
					return [{
						id: String(id),
						title: htmlText(result.content?.title ?? result.title ?? ""),
						space: result.resultGlobalContainer?.title ?? null,
						url: `${base}${result.content?._links?.webui ?? result.url ?? ""}`,
						excerpt: htmlText((result.excerpt ?? "").replace(/@@@(end)?hl@@@/g, "")),
						lastModified: result.lastModified ?? null
					}];
				})
			};
		},
		async page(given) {
			const id = String(given ?? "").trim();
			if (!/^\d+$/.test(id)) return {
				ok: false,
				reason: "That is not a Confluence page id."
			};
			const answer = await request(`/wiki/api/v2/pages/${id}?body-format=view`);
			if (!answer.ok) return answer;
			const raw = answer.json ?? {};
			let space = null;
			if (raw.spaceId) {
				if (!spaceNames.has(raw.spaceId)) {
					const found = await request(`/wiki/api/v2/spaces/${encodeURIComponent(raw.spaceId)}`);
					const spaceName = found.ok ? found.json?.name : void 0;
					if (typeof spaceName === "string") spaceNames.set(raw.spaceId, spaceName);
				}
				space = spaceNames.get(raw.spaceId) ?? null;
			}
			const ref = {
				id,
				title: raw.title ?? "",
				space,
				url: `${raw._links?.base ?? wiki()}${raw._links?.webui ?? `/pages/viewpage.action?pageId=${id}`}`
			};
			writePrivate(recentFile, `${JSON.stringify([{
				...ref,
				openedAt: now()
			}, ...recent().filter((page) => page.id !== id)].slice(0, RECENT_MAX))}\n`);
			return {
				ok: true,
				page: {
					page: ref,
					html: raw.body?.view?.value ?? ""
				}
			};
		},
		recent
	};
}
//#endregion
//#region apps/agent-world/src/backend/integrations/delegation.ts
var NOTE_MAX = 4e3;
/** The awake character a delegation goes to: a named one, or `coordinator` (the one `near` reports to, else the first). */
function delegationTarget(snapshot, to, near) {
	const awake = (id) => id ? snapshot.characters.find((c) => c.id === id) : void 0;
	if (to !== "coordinator") return awake(to);
	const theirs = awake(near ? awake(near)?.facts?.reportsTo : void 0);
	if (theirs?.role === "coordinator") return theirs;
	for (const headquarters of snapshot.headquarters) {
		const coordinator = awake(headquarters.id);
		if (coordinator) return coordinator;
	}
	return snapshot.characters.find((c) => c.role === "coordinator");
}
var quoted = (text) => `"${text.replace(/\s+/g, " ").trim()}"`;
function itemName(item) {
	switch (item.kind) {
		case "pull-request": return `pull request ${item.repo}#${item.number} ${quoted(item.title)}: ${item.url}`;
		case "issue": return `Jira issue ${item.key} ${quoted(item.summary)}: ${item.url}`;
		case "page": return `the Confluence page ${quoted(item.title)}: ${item.url}`;
		case "thread": return `this Slack thread in #${item.channelName}${item.preview ? ` (${quoted(item.preview)})` : ""}: ${item.url ?? `channel ${item.channel}, thread ${item.ts}`}`;
	}
}
/** The instruction's words: what is asked, the item with its address, then the operator's own note. */
function delegationText(delegation) {
	const { item, ask } = delegation;
	const name = itemName(item);
	return `${{
		"address-review": `Please address the review on ${name}`,
		"get-reviewed": `Please get ${name} reviewed`,
		"start-work": `Please start work on ${name}`,
		summarise: `Please read ${name}\nSummarise it for me here.`,
		update: `Please update ${name}`,
		"look-into": `Please look into ${name}`
	}[ask]}${item.kind === "thread" ? "\nReport back to me here; do not post in Slack." : ""}${delegation.note?.trim() ? `\n\n${delegation.note.trim().slice(0, NOTE_MAX)}` : ""}`;
}
var ASKS = /* @__PURE__ */ new Set([
	"address-review",
	"get-reviewed",
	"start-work",
	"summarise",
	"update",
	"look-into"
]);
var text = (value) => typeof value === "string" && value.length > 0 && value.length < 2e3;
/** The delegation as given over IPC, checked field by field; undefined when it is not one. */
function checkDelegation(given) {
	const value = given ?? {};
	if (!text(value.to) || !ASKS.has(String(value.ask)) || !value.item) return void 0;
	if (value.near !== void 0 && !text(value.near)) return void 0;
	if (value.note !== void 0 && typeof value.note !== "string") return void 0;
	const item = value.item;
	return item.kind === "pull-request" && text(item.repo) && Number.isSafeInteger(item.number) && typeof item.title === "string" && text(item.url) || item.kind === "issue" && text(item.key) && typeof item.summary === "string" && text(item.url) || item.kind === "page" && text(item.id) && typeof item.title === "string" && text(item.url) || item.kind === "thread" && text(item.channel) && typeof item.channelName === "string" && text(item.ts) && (item.url === null || text(item.url)) && (item.preview === void 0 || typeof item.preview === "string") ? value : void 0;
}
/** Send a delegation; receipts reach `onReceipt` with the character they are for. */
async function delegate(commands, snapshot, commandId, given, onReceipt) {
	const delegation = checkDelegation(given);
	if (!delegation) return {
		ok: false,
		reason: "That request does not name what to work on."
	};
	const target = delegationTarget(snapshot, delegation.to, delegation.near);
	if (!target) return {
		ok: false,
		reason: delegation.to === "coordinator" ? "No coordinator is awake." : "That agent is not awake."
	};
	const command = (target.facts?.run ?? "idle") === "idle" ? "talk" : "follow_up";
	const result = await instruct(commands, target, commandId, {
		kind: command,
		text: delegationText(delegation)
	}, (stage, reason) => onReceipt(target.id, stage, reason));
	return result.ok ? {
		ok: true,
		to: target.id,
		command
	} : result;
}
//#endregion
//#region apps/agent-world/src/backend/integrations/gate.ts
/** How long a description stays good for confirming. */
var TOKEN_TTL_MS = 9e5;
/** Longest text one write may carry. */
var TEXT_MAX = 3e4;
var PREVIEW$1 = 100;
/** The intent as given over IPC, checked and trimmed of anything else; a reason when it is not one. */
function checkIntent(given) {
	const value = given ?? {};
	const words = (key) => typeof value[key] === "string" ? value[key] : void 0;
	const long = (text) => text !== void 0 && text.length > TEXT_MAX;
	switch (value.kind) {
		case "github-review": {
			const { repo, number, event } = value;
			const body = words("body") ?? "";
			if (typeof repo !== "string" || !Number.isSafeInteger(number)) return "That is not a pull request.";
			if (event !== "comment" && event !== "approve" && event !== "request-changes") return "That is not a review.";
			if (event !== "approve" && !body.trim()) return "Write what to say first.";
			if (long(body)) return "That is too long to send from here.";
			return {
				kind: "github-review",
				repo,
				number,
				event,
				body
			};
		}
		case "jira-comment": {
			const key = words("key");
			const body = words("body");
			if (!key) return "That is not a Jira issue.";
			if (!body?.trim()) return "Write what to say first.";
			if (long(body)) return "That is too long to send from here.";
			return {
				kind: "jira-comment",
				key,
				body
			};
		}
		case "jira-transition": {
			const key = words("key");
			const transition = words("transition");
			if (!key || !transition) return "That is not a move Jira offers.";
			return {
				kind: "jira-transition",
				key,
				transition
			};
		}
		case "slack-reply": {
			const channel = words("channel");
			const threadTs = words("threadTs");
			const text = words("text");
			if (!channel || !threadTs) return "That is not a Slack thread.";
			if (!text?.trim()) return "Write what to say first.";
			if (long(text)) return "That is too long to send from here.";
			return {
				kind: "slack-reply",
				channel,
				threadTs,
				text
			};
		}
		case "slack-mark-read": {
			const channel = words("channel");
			const ts = words("ts");
			const threadTs = words("threadTs");
			if (!channel || !ts || value.threadTs !== void 0 && !threadTs) return "That is not a Slack channel.";
			return {
				kind: "slack-mark-read",
				channel,
				ts,
				...threadTs ? { threadTs } : {}
			};
		}
	}
	return "Agent World does not write that.";
}
/** One string per intent, the same for the same write whatever order its keys came in. */
var canonical = (intent) => JSON.stringify(Object.fromEntries(Object.entries(intent).sort(([a], [b]) => a.localeCompare(b))));
var preview$1 = (text) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > PREVIEW$1 ? `${flat.slice(0, 99)}\u2026` : flat;
};
/** The chatbox line for a write: what the operator did, or that it failed. */
function writeLine(intent, description, failed) {
	const said = description.text ? `: ${preview$1(description.text)}` : "";
	switch (intent.kind) {
		case "github-review": {
			const ref = `${intent.repo}#${intent.number}`;
			if (failed) return `Your ${{
				approve: "approval of",
				comment: "comment on",
				"request-changes": "change request on"
			}[intent.event]} ${ref} failed: ${failed}`;
			if (intent.event === "approve") return `You approved ${ref}${said}.`;
			if (intent.event === "comment") return `You commented on ${ref}${said}`;
			return `You requested changes on ${ref}${said}`;
		}
		case "jira-comment": return failed ? `Your comment on ${intent.key} failed: ${failed}` : `You commented on ${intent.key}${said}`;
		case "jira-transition": return failed ? `Moving ${intent.key} failed: ${failed}` : `You moved ${intent.key}${said}.`;
		case "slack-reply": {
			const where = description.where.split(",")[0];
			return failed ? `Your reply in ${where} failed: ${failed}` : `You replied in ${where}${said}`;
		}
		case "slack-mark-read": {
			const [place, thread] = description.where.split(", in ");
			const what = thread ? `${thread} in ${place}` : place;
			return failed ? `Marking ${what} read failed: ${failed}` : `You marked ${what} read in Slack.`;
		}
	}
}
/**
* Writes the operator asks for with a button that says exactly what it does (Mark read), which change nothing anyone
* else reads: sent without the confirmation, but recorded and announced like every other.
*/
var UNCONFIRMED = /* @__PURE__ */ new Set(["slack-mark-read"]);
function openGate(recordFile, adapters, now = Date.now) {
	const waiting = /* @__PURE__ */ new Map();
	const listeners = /* @__PURE__ */ new Set();
	const record = (entry) => {
		mkdirSync(dirname(recordFile), {
			recursive: true,
			mode: 448
		});
		const fresh = !existsSync(recordFile);
		appendFileSync(recordFile, `${JSON.stringify({
			...entry,
			at: new Date(entry.at).toISOString()
		})}\n`, { mode: 384 });
		if (fresh) chmodSync(recordFile, 384);
		for (const listener of listeners) listener(entry);
	};
	/** Send a write as described, then record and announce it, sent or failed. */
	const send = async (intent, description) => {
		const sent = await adapters.send(intent);
		const { what, where, text } = description;
		const entry = {
			at: now(),
			kind: intent.kind,
			what,
			where,
			text,
			url: (sent.ok ? sent.url : void 0) ?? description.url,
			ok: sent.ok,
			...sent.ok ? {} : { reason: sent.reason },
			line: writeLine(intent, description, sent.ok ? void 0 : sent.reason)
		};
		record(entry);
		return sent.ok ? {
			ok: true,
			entry
		} : sent;
	};
	return {
		async describe(given) {
			const intent = checkIntent(given);
			if (typeof intent === "string") return {
				ok: false,
				reason: intent
			};
			const described = await adapters.describe(intent);
			if (!described.ok) return described;
			for (const [token, held] of waiting) if (held.until <= now()) waiting.delete(token);
			const token = randomUUID();
			waiting.set(token, {
				key: canonical(intent),
				description: described.description,
				until: now() + TOKEN_TTL_MS
			});
			return {
				ok: true,
				token,
				description: described.description
			};
		},
		async write(given, token) {
			const intent = checkIntent(given);
			if (typeof intent === "string") return {
				ok: false,
				reason: intent
			};
			const held = typeof token === "string" ? waiting.get(token) : void 0;
			if (!held || held.key !== canonical(intent) || held.until <= now()) return {
				ok: false,
				reason: "That was not confirmed as shown, so nothing was sent."
			};
			waiting.delete(token);
			return send(intent, held.description);
		},
		async act(given) {
			const intent = checkIntent(given);
			if (typeof intent === "string") return {
				ok: false,
				reason: intent
			};
			if (!UNCONFIRMED.has(intent.kind)) return {
				ok: false,
				reason: "That needs your confirmation, so nothing was sent."
			};
			const described = await adapters.describe(intent);
			if (!described.ok) return described;
			return send(intent, described.description);
		},
		recent() {
			if (!existsSync(recordFile)) return [];
			return readFileSync(recordFile, "utf8").split("\n").filter(Boolean).slice(-100).flatMap((line) => {
				try {
					const entry = JSON.parse(line);
					return [{
						...entry,
						at: typeof entry.at === "string" ? Date.parse(entry.at) : entry.at
					}];
				} catch {
					return [];
				}
			});
		},
		onWrite(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}
//#endregion
//#region apps/agent-world/src/integrations.ts
var DIFF_LINES_MAX = 2e4;
//#endregion
//#region apps/agent-world/src/backend/integrations/github.ts
var TIMEOUT_MS$1 = 3e4;
var LIST_MAX$1 = 50;
/** `gh pr view` calls in flight at once while filling in searched pull requests. */
var PARALLEL = 4;
var REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
var ROLLUP_FIELDS = "headRefName,statusCheckRollup,reviewDecision";
var LIST_FIELDS = `number,title,url,isDraft,updatedAt,author,${ROLLUP_FIELDS}`;
function runner(env) {
	return (args, cwd) => new Promise((resolve) => {
		execFile("gh", args, {
			cwd,
			env: env ?? process.env,
			timeout: TIMEOUT_MS$1,
			maxBuffer: 67108864
		}, (error, stdout, stderr) => {
			if (!error) return resolve({
				ok: true,
				stdout
			});
			if (error.code === "ENOENT") return resolve({
				ok: false,
				reason: "The GitHub CLI (gh) is not installed.",
				signIn: "github"
			});
			const said = String(stderr).trim();
			if (/gh auth login|not logged in|authentication/i.test(said)) return resolve({
				ok: false,
				reason: "Sign in to GitHub with `gh auth login` first.",
				signIn: "github"
			});
			resolve({
				ok: false,
				reason: said.split("\n").slice(-3).join(" ") || error.message
			});
		});
	});
}
var parse = (text) => {
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
};
/** One entry of `statusCheckRollup`: a check run (status and conclusion) or a commit status (state). */
function checkState(check) {
	const { status, conclusion, state } = check ?? {};
	if (typeof state === "string") {
		if (state === "SUCCESS") return "passing";
		if (state === "FAILURE" || state === "ERROR") return "failing";
		return "running";
	}
	if (status !== "COMPLETED") return "running";
	switch (conclusion) {
		case "SUCCESS": return "passing";
		case "NEUTRAL":
		case "SKIPPED":
		case "STALE": return "skipped";
		default: return "failing";
	}
}
/** A pull request's checks rolled up: any failed is failing, else any unfinished is running, else passing. */
function ciRollup(rollup) {
	const states = (Array.isArray(rollup) ? rollup : []).map(checkState);
	const count = (state) => states.filter((one) => one === state).length;
	const checks = {
		passing: count("passing"),
		failing: count("failing"),
		running: count("running"),
		total: states.length
	};
	return {
		ci: checks.failing ? "failing" : checks.running ? "running" : states.length ? "passing" : "none",
		checks
	};
}
/** Link each pull request to the agent whose repository and branch it comes from (repository names ignore case). */
function linkPullRequests(pullRequests, agents) {
	return pullRequests.map((pr) => {
		const agent = agents.find((one) => one.branch === pr.branch && one.repo.toLowerCase() === pr.repo.toLowerCase());
		return {
			...pr,
			agent: agent ? {
				id: agent.id,
				name: agent.name
			} : null
		};
	});
}
var unquote = (path) => path.replace(/^"(.*)"$/, "$1");
/** Read one line of a file's extended header (before its first hunk) into `file`. */
function fileHeader(file, line) {
	if (line.startsWith("new file mode")) file.status = "added";
	else if (line.startsWith("deleted file mode")) file.status = "deleted";
	else if (line.startsWith("rename from ")) {
		file.oldPath = line.slice(12);
		file.status = "renamed";
	} else if (line.startsWith("rename to ")) file.path = line.slice(10);
	else if (line.startsWith("Binary files ")) file.binary = true;
	else if (line.startsWith("--- ") && line !== "--- /dev/null") file.oldPath = unquote(line.slice(4).replace(/^a\//, ""));
	else if (line.startsWith("+++ ") && line !== "+++ /dev/null") file.path = unquote(line.slice(4).replace(/^b\//, ""));
}
/** A unified diff (`gh pr diff`) as files and hunks with line numbers on both sides; cut after `max` lines. */
function parseDiff(patch, max = DIFF_LINES_MAX) {
	const files = [];
	let file;
	let hunk;
	let oldLine = 0;
	let newLine = 0;
	let lines = 0;
	let cut = false;
	for (const line of patch.split("\n")) {
		if (line.startsWith("diff --git ")) {
			const paths = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
			const path = unquote(paths?.[2] ?? "");
			file = {
				path,
				oldPath: unquote(paths?.[1] ?? path),
				status: "modified",
				binary: false,
				additions: 0,
				deletions: 0,
				hunks: []
			};
			files.push(file);
			hunk = void 0;
			continue;
		}
		if (!file) continue;
		if (!hunk) fileHeader(file, line);
		const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (header) {
			oldLine = Number(header[1]);
			newLine = Number(header[2]);
			hunk = {
				header: line,
				lines: []
			};
			file.hunks.push(hunk);
			continue;
		}
		if (!hunk || line.startsWith("\\")) continue;
		const mark = line[0];
		if (mark !== "+" && mark !== "-" && mark !== " ") continue;
		if (mark === "+") file.additions++;
		if (mark === "-") file.deletions++;
		if (lines >= max) {
			cut = true;
			continue;
		}
		lines++;
		const text = line.slice(1);
		if (mark === "+") hunk.lines.push({
			kind: "add",
			old: null,
			new: newLine++,
			text
		});
		else if (mark === "-") hunk.lines.push({
			kind: "del",
			old: oldLine++,
			new: null,
			text
		});
		else hunk.lines.push({
			kind: "context",
			old: oldLine++,
			new: newLine++,
			text
		});
	}
	return {
		files,
		cut
	};
}
/** The `owner/name` in a pull request's address. */
var repoOf = (url) => /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url)?.[1] ?? "";
function toPullRequest(raw, involvesYou) {
	const { ci, checks } = ciRollup(raw.statusCheckRollup);
	return {
		repo: raw.repository?.nameWithOwner ?? repoOf(raw.url),
		number: raw.number,
		title: raw.title ?? "",
		url: raw.url,
		author: raw.author?.login ?? null,
		draft: raw.isDraft === true,
		branch: raw.headRefName ?? null,
		updatedAt: raw.updatedAt ?? null,
		ci,
		checks,
		reviewDecision: raw.reviewDecision || null,
		involvesYou
	};
}
function validPullRequest(repo, number) {
	return typeof repo === "string" && REPO.test(repo) && Number.isSafeInteger(number) && number > 0;
}
function openGitHub(env) {
	const gh = runner(env);
	const repos = /* @__PURE__ */ new Map();
	const repoAt = (directory) => {
		let known = repos.get(directory);
		if (!known) {
			known = gh([
				"repo",
				"view",
				"--json",
				"nameWithOwner,defaultBranchRef"
			], directory).then((answer) => {
				if (!answer.ok) {
					repos.delete(directory);
					return;
				}
				const value = parse(answer.stdout);
				return value?.nameWithOwner ? {
					repo: value.nameWithOwner,
					defaultBranch: value.defaultBranchRef?.name ?? null
				} : void 0;
			});
			repos.set(directory, known);
		}
		return known;
	};
	/** The awake agents on a branch of a GitHub repository other than its default branch. */
	const agentBranches = async (characters) => {
		return (await Promise.all(characters.map(async (character) => {
			const git = character.facts?.git;
			if (!git?.branch || git.branch === "HEAD") return void 0;
			const repo = await repoAt(git.repository);
			if (!repo || git.branch === repo.defaultBranch) return void 0;
			return {
				id: character.id,
				name: character.name,
				repo: repo.repo,
				branch: git.branch
			};
		}))).filter((agent) => agent !== void 0);
	};
	/** Run `work` over `items`, `PARALLEL` at a time. */
	const inParallel = async (items, work) => {
		const results = new Array(items.length);
		let next = 0;
		await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await work(items[index]);
			}
		}));
		return results;
	};
	return {
		async pullRequests(characters) {
			const [searched, agents] = await Promise.all([gh([
				"search",
				"prs",
				"--involves",
				"@me",
				"--state",
				"open",
				"--limit",
				String(LIST_MAX$1),
				"--json",
				"number,title,url,repository,author,isDraft,updatedAt"
			]), agentBranches(characters)]);
			if (!searched.ok) return searched;
			const branchKeys = [...new Map(agents.map((agent) => [`${agent.repo}\n${agent.branch}`, agent])).values()];
			const fromBranches = (await inParallel(branchKeys, (agent) => gh([
				"pr",
				"list",
				"-R",
				agent.repo,
				"--head",
				agent.branch,
				"--state",
				"open",
				"--json",
				LIST_FIELDS
			]))).flatMap((answer) => answer.ok ? parse(answer.stdout) ?? [] : []);
			const mine = parse(searched.stdout) ?? [];
			const byUrl = new Map(fromBranches.map((raw) => [raw.url, raw]));
			const filled = await inParallel(mine, async (raw) => {
				const listed = byUrl.get(raw.url);
				if (listed) return {
					...listed,
					...raw,
					headRefName: listed.headRefName
				};
				const repo = raw.repository?.nameWithOwner ?? repoOf(raw.url);
				const answer = await gh([
					"pr",
					"view",
					String(raw.number),
					"-R",
					repo,
					"--json",
					ROLLUP_FIELDS
				]);
				return answer.ok ? {
					...raw,
					...parse(answer.stdout)
				} : raw;
			});
			const mineUrls = new Set(mine.map((raw) => raw.url));
			const all = [...filled.map((raw) => toPullRequest(raw, true)), ...fromBranches.filter((raw) => !mineUrls.has(raw.url)).map((raw) => toPullRequest(raw, false))];
			const unique = [...new Map(all.map((pr) => [pr.url, pr])).values()];
			unique.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
			return {
				ok: true,
				pullRequests: linkPullRequests(unique, agents)
			};
		},
		async pullRequest(repo, number, characters) {
			if (!validPullRequest(repo, number)) return {
				ok: false,
				reason: "That is not a pull request."
			};
			const [viewed, diffed, agents] = await Promise.all([
				gh([
					"pr",
					"view",
					String(number),
					"-R",
					repo,
					"--json",
					`number,title,body,url,author,isDraft,state,updatedAt,baseRefName,${ROLLUP_FIELDS}`
				]),
				gh([
					"pr",
					"diff",
					String(number),
					"-R",
					repo
				]),
				agentBranches(characters)
			]);
			if (!viewed.ok) return viewed;
			if (!diffed.ok) return diffed;
			const raw = parse(viewed.stdout);
			if (!raw) return {
				ok: false,
				reason: "gh answered something that is not JSON."
			};
			const [pullRequest] = linkPullRequests([toPullRequest({
				...raw,
				repository: { nameWithOwner: repo }
			}, false)], agents);
			const { files, cut } = parseDiff(diffed.stdout);
			const checks = (Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup : []).map((check) => {
				const named = check;
				return {
					name: named.name ?? named.context ?? "check",
					state: checkState(check)
				};
			});
			return {
				ok: true,
				detail: {
					pullRequest,
					body: raw.body ?? "",
					baseBranch: raw.baseRefName ?? null,
					state: raw.state ?? "OPEN",
					checks,
					files,
					cut
				}
			};
		},
		async review(repo, number, event, body) {
			if (!validPullRequest(repo, number)) return {
				ok: false,
				reason: "That is not a pull request."
			};
			const args = [
				"pr",
				"review",
				String(number),
				"-R",
				repo,
				event === "approve" ? "--approve" : event === "comment" ? "--comment" : "--request-changes",
				...body ? ["--body", body] : []
			];
			const answer = await gh(args);
			return answer.ok ? { ok: true } : answer;
		}
	};
}
//#endregion
//#region apps/agent-world/src/backend/integrations/jira.ts
var FIELDS = [
	"summary",
	"status",
	"issuetype",
	"priority",
	"project",
	"assignee",
	"updated"
];
var LIST_MAX = 50;
var ASSIGNED_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
var KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
function issueKey(text) {
	if (typeof text !== "string") return void 0;
	const key = text.trim().toUpperCase();
	return KEY.test(key) ? key : void 0;
}
var name = (value, field = "name") => {
	const named = value;
	return named && typeof named[field] === "string" ? named[field] : null;
};
function toIssue(site, raw) {
	const issue = raw;
	const fields = issue.fields ?? {};
	const status = fields.status;
	return {
		key: issue.key,
		summary: typeof fields.summary === "string" ? fields.summary : "",
		status: name(status),
		statusCategory: status?.statusCategory?.key ?? null,
		type: name(fields.issuetype),
		priority: name(fields.priority),
		project: name(fields.project, "key"),
		assignee: name(fields.assignee, "displayName"),
		updated: typeof fields.updated === "string" ? fields.updated : null,
		url: `${site}/browse/${issue.key}`
	};
}
/** Atlassian Document Format to plain text: paragraphs and list items on their own lines. */
function adfText(node) {
	const walk = (value) => {
		if (!value || typeof value !== "object") return "";
		const { type, text, attrs, content } = value;
		const inner = Array.isArray(content) ? content.map(walk).join("") : "";
		switch (type) {
			case "text": return text ?? "";
			case "hardBreak": return "\n";
			case "mention": return typeof attrs?.text === "string" ? attrs.text : "@someone";
			case "emoji": return typeof attrs?.shortName === "string" ? attrs.shortName : "";
			case "inlineCard":
			case "blockCard": return typeof attrs?.url === "string" ? attrs.url : "";
			case "listItem": return `- ${inner.trim()}\n`;
			case "paragraph":
			case "heading":
			case "codeBlock":
			case "blockquote":
			case "rule": return `${inner}\n\n`;
			default: return inner;
		}
	};
	return walk(node).replace(/\n{3,}/g, "\n\n").trim();
}
/** Plain text as an ADF document: blank lines part paragraphs, single newlines become hard breaks. */
function textAdf(text) {
	return {
		type: "doc",
		version: 1,
		content: text.replace(/\r\n/g, "\n").split(/\n\s*\n/).filter((part) => part.trim()).map((paragraph) => ({
			type: "paragraph",
			content: paragraph.split("\n").flatMap((line, index) => [...index > 0 ? [{ type: "hardBreak" }] : [], ...line ? [{
				type: "text",
				text: line
			}] : []])
		}))
	};
}
function openJira(credentials, fetchImpl) {
	const request = (path, options = {}) => atlassianRequest(credentials(), path, {
		...options,
		fetch: fetchImpl
	});
	const site = () => credentials()?.site ?? "";
	const badKey = {
		ok: false,
		reason: "That is not a Jira issue key."
	};
	const jql = async (query) => {
		const answer = await request("/rest/api/3/search/jql", {
			method: "POST",
			body: {
				jql: query,
				fields: FIELDS,
				maxResults: LIST_MAX
			}
		});
		if (!answer.ok) return answer;
		return {
			ok: true,
			issues: (answer.json?.issues ?? []).map((issue) => toIssue(site(), issue))
		};
	};
	return {
		async myself() {
			const answer = await request("/rest/api/3/myself");
			if (!answer.ok) return answer;
			return {
				ok: true,
				name: name(answer.json, "displayName")
			};
		},
		assigned: () => jql(ASSIGNED_JQL),
		async search(text) {
			const words = queryText(text);
			if (!words) return {
				ok: true,
				issues: []
			};
			const found = await jql(`text ~ "${words}" ORDER BY updated DESC`);
			const key = issueKey(text);
			if (!key || !found.ok) return found;
			const exact = await request(`/rest/api/3/issue/${key}?fields=${FIELDS.join(",")}`);
			if (!exact.ok) return found;
			const issue = toIssue(site(), exact.json);
			return {
				ok: true,
				issues: [issue, ...found.issues.filter((other) => other.key !== issue.key)]
			};
		},
		async issue(given) {
			const key = issueKey(given);
			if (!key) return badKey;
			const fields = [
				...FIELDS,
				"description",
				"comment",
				"reporter",
				"created"
			].join(",");
			const answer = await request(`/rest/api/3/issue/${key}?fields=${fields}&expand=renderedFields`);
			if (!answer.ok) return answer;
			const raw = answer.json;
			const fields_ = raw.fields ?? {};
			const rendered = raw.renderedFields ?? {};
			const comments = fields_.comment?.comments ?? [];
			const renderedComments = rendered.comment?.comments ?? [];
			const htmlOf = new Map(renderedComments.map((comment) => [comment.id, comment.body]));
			const descriptionHtml = typeof rendered.description === "string" ? rendered.description : null;
			return {
				ok: true,
				detail: {
					issue: toIssue(site(), raw),
					reporter: name(fields_.reporter, "displayName"),
					created: typeof fields_.created === "string" ? fields_.created : null,
					descriptionHtml,
					descriptionText: fields_.description ? adfText(fields_.description) : descriptionHtml ? htmlText(descriptionHtml) : "",
					comments: comments.map((comment) => {
						const html = htmlOf.get(comment.id);
						return {
							id: comment.id,
							author: name(comment.author, "displayName"),
							created: comment.created ?? null,
							html: typeof html === "string" ? html : null,
							text: comment.body ? adfText(comment.body) : typeof html === "string" ? htmlText(html) : ""
						};
					})
				}
			};
		},
		async transitions(given) {
			const key = issueKey(given);
			if (!key) return badKey;
			const answer = await request(`/rest/api/3/issue/${key}/transitions`);
			if (!answer.ok) return answer;
			return {
				ok: true,
				transitions: (answer.json?.transitions ?? []).filter((transition) => transition.isAvailable !== false).map((transition) => ({
					id: String(transition.id),
					name: transition.name,
					to: transition.to?.name ?? null,
					toCategory: transition.to?.statusCategory?.key ?? null
				}))
			};
		},
		async comment(given, body) {
			const key = issueKey(given);
			if (!key) return badKey;
			const answer = await request(`/rest/api/3/issue/${key}/comment`, {
				method: "POST",
				body: { body: textAdf(body) }
			});
			if (!answer.ok) return answer;
			const id = answer.json?.id;
			return {
				ok: true,
				url: `${site()}/browse/${key}${typeof id === "string" ? `?focusedCommentId=${id}` : ""}`
			};
		},
		async transition(given, transitionId) {
			const key = issueKey(given);
			if (!key) return badKey;
			const answer = await request(`/rest/api/3/issue/${key}/transitions`, {
				method: "POST",
				body: { transition: { id: transitionId } }
			});
			if (!answer.ok) return answer;
			return {
				ok: true,
				url: `${site()}/browse/${key}`
			};
		}
	};
}
//#endregion
//#region apps/agent-world/src/backend/integrations/slack.ts
var TIMEOUT_MS = 2e4;
/** Most messages counted per channel; beyond it `more` is set. */
var COUNT_LIMIT = 100;
var CHANNEL_MESSAGES = 50;
var THREAD_MESSAGES = 200;
var FOUND_MAX = 50;
/** Messages per page of a search (Slack's own default; its most is 100), and the last page Slack serves. */
var SEARCH_COUNT = 20;
var SEARCH_PAGES_MAX = 100;
/** A search hit's excerpt: at most this many characters, starting this many before the first match. */
var EXCERPT_MAX = 240;
var EXCERPT_BEFORE = 80;
/** Opened at a message: this many up to it, and up to this many after it (all of them, or none: see `channel`). */
var AROUND_BEFORE = 25;
var AROUND_AFTER = 50;
/** People named at once (`users.info`) when every direct message is listed. */
var NAMING_AT_ONCE = 6;
/** How long the lists of channels are kept before they are read again. */
var LIST_TTL_MS = 6e5;
var SIGN_IN_ERRORS = /* @__PURE__ */ new Set([
	"invalid_auth",
	"not_authed",
	"token_revoked",
	"token_expired",
	"account_inactive"
]);
var NOT_SIGNED_IN = {
	ok: false,
	reason: "Sign in to Slack in Settings first.",
	signIn: "slack"
};
var ID = /^[A-Z0-9]+$/;
var TS = /^\d+\.\d+$/;
/** A message link in the workspace: `<url>archives/<channel>/p<ts without the dot>`. */
function slackLink(base, channel, ts) {
	if (!base) return null;
	return `${base.endsWith("/") ? base : `${base}/`}archives/${channel}${ts ? `/p${ts.replace(".", "")}` : ""}`;
}
/** A group's name as Slack shows it: `mpdm-ann--ben--me-1` is "ann, ben" for `me`. */
function groupName(name, me) {
	const people = /^mpdm-(.+)-\d+$/.exec(name)?.[1]?.split("--");
	if (!people) return name;
	const others = people.filter((person) => person !== me);
	return (others.length ? others : people).join(", ");
}
/**
* A search hit's text (Slack's highlight markers U+E000 and U+E001 around each match) as an excerpt in parts: on one
* line, cut to `EXCERPT_MAX` characters around the first match, with an ellipsis where it was cut.
*/
function excerptOf(text) {
	const parts = [];
	let match = false;
	for (const piece of text.replace(/\s+/g, " ").trim().split(/([\ue000\ue001])/)) if (piece === "" || piece === "") match = piece === "";
	else if (piece) {
		const last = parts.at(-1);
		if (last && last.match === match) last.text += piece;
		else parts.push({
			text: piece,
			match
		});
	}
	const total = parts.reduce((sum, part) => sum + part.text.length, 0);
	if (total <= EXCERPT_MAX) return parts;
	let first = 0;
	for (const part of parts) {
		if (part.match) break;
		first += part.text.length;
	}
	if (first >= total) first = 0;
	const start = Math.max(0, Math.min(first - EXCERPT_BEFORE, total - EXCERPT_MAX));
	const end = start + EXCERPT_MAX;
	const cut = [];
	let at = 0;
	for (const part of parts) {
		const from = Math.max(start, at);
		const to = Math.min(end, at + part.text.length);
		if (to > from) cut.push({
			text: part.text.slice(from - at, to - at),
			match: part.match
		});
		at += part.text.length;
	}
	if (start > 0) cut[0] = {
		...cut[0],
		text: `\u2026${cut[0].text.trimStart()}`
	};
	if (end < total) cut[cut.length - 1] = {
		...cut[cut.length - 1],
		text: `${cut[cut.length - 1].text.trimEnd()}\u2026`
	};
	return cut;
}
/** Run `work` over `items`, at most `limit` at a time, keeping their order. */
async function atMost(items, limit, work) {
	const out = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			out[index] = await work(items[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}
/** Slack timestamps (`1700000000.000100`) in order; as strings, since they have more digits than a double keeps. */
var byTs = (a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
function openSlack(credentials, options = {}) {
	const now = options.now ?? Date.now;
	const users = /* @__PURE__ */ new Map();
	let members;
	let everything;
	const names = /* @__PURE__ */ new Map();
	/** Where the operator last read each channel, as the last unread listing or Mark read left it. */
	const lastRead = /* @__PURE__ */ new Map();
	const call = async (method, params, session = credentials()) => {
		if (!session) return NOT_SIGNED_IN;
		const base = options.api ?? (session.url ? `${session.url.replace(/\/?$/, "/")}api/` : "https://slack.com/api/");
		let response;
		try {
			response = await (options.fetch ?? fetch)(`${base}${method}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Cookie: `d=${session.cookie}`
				},
				body: new URLSearchParams({
					token: session.token,
					...params
				}).toString(),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch {
			return {
				ok: false,
				reason: "Could not reach Slack."
			};
		}
		if (response.status === 429) return {
			ok: false,
			reason: "Slack asks to slow down; try again in a minute."
		};
		let json;
		try {
			json = await response.json();
		} catch {
			return {
				ok: false,
				reason: `Slack answered ${response.status}.`
			};
		}
		if (json.ok === true) return {
			ok: true,
			json
		};
		const error = typeof json.error === "string" ? json.error : `status ${response.status}`;
		if (SIGN_IN_ERRORS.has(error)) return {
			ok: false,
			reason: "Slack signed you out; sign in again in Settings.",
			signIn: "slack"
		};
		return {
			ok: false,
			reason: `Slack said ${error}.`
		};
	};
	/** Every page of a cursor-paged list method. */
	const pages = async (method, params) => {
		const rows = [];
		let cursor = "";
		for (let page = 0; page < 50; page++) {
			const answer = await call(method, {
				...params,
				limit: "1000",
				...cursor ? { cursor } : {}
			});
			if (!answer.ok) return answer;
			rows.push(...answer.json.channels ?? []);
			cursor = answer.json.response_metadata?.next_cursor ?? "";
			if (!cursor) break;
		}
		for (const row of rows) names.set(row.id, row);
		return {
			ok: true,
			rows
		};
	};
	const memberRows = async () => {
		if (members && now() - members.at < LIST_TTL_MS) return {
			ok: true,
			rows: members.rows
		};
		const listed = await pages("users.conversations", {
			types: "public_channel,private_channel,mpim,im",
			exclude_archived: "true"
		});
		if (listed.ok) members = {
			at: now(),
			rows: listed.rows
		};
		return listed;
	};
	const userName = async (id) => {
		const known = users.get(id);
		if (known) return known;
		const answer = await call("users.info", { user: id });
		const user = answer.ok ? answer.json.user : void 0;
		const name = user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name || id;
		if (answer.ok) users.set(id, name);
		return name;
	};
	const kindOf = (row) => row?.is_im ? "dm" : row?.is_mpim ? "group" : row?.is_private || row?.is_group ? "private" : "channel";
	const me = () => credentials()?.user ?? null;
	const nameOf = async (row, id) => {
		if (row?.is_im && row.user) return userName(row.user);
		if (row?.is_mpim && row.name) return groupName(row.name, me());
		if (row?.name) return row.name;
		const answer = await call("conversations.info", { channel: id });
		const info = answer.ok ? answer.json.channel : void 0;
		if (info) names.set(id, info);
		if (info?.is_im && info.user) return userName(info.user);
		if (info?.is_mpim && info.name) return groupName(info.name, me());
		return info?.name ?? id;
	};
	/** Slack's message markup as plain text: people, channels, and links by name; entities decoded. */
	const plain = async (text) => {
		const mentioned = [...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((match) => match[1]))];
		for (const id of mentioned) await userName(id);
		return text.replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_all, id) => `@${users.get(id) ?? id}`).replace(/<#([A-Z0-9]+)\|([^>]*)>/g, (_all, id, name) => `#${name || names.get(id)?.name || id}`).replace(/<!(here|channel|everyone)[^>]*>/g, "@$1").replace(/<([^|>]+)\|([^>]+)>/g, "$2 ($1)").replace(/<([^>]+)>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
	};
	const messages = async (rows) => Promise.all(rows.map(async (row) => ({
		ts: row.ts,
		threadTs: row.thread_ts ?? null,
		user: row.user ?? null,
		name: row.user ? await userName(row.user) : row.username ?? row.bot_profile?.name ?? "someone",
		text: await plain(row.text ?? ""),
		replies: row.reply_count ?? 0,
		at: Math.round(Number(row.ts) * 1e3)
	})));
	const teamUrl = () => credentials()?.url ?? null;
	const badChannel = {
		ok: false,
		reason: "That is not a Slack channel."
	};
	/** Channels named like `text`: every public and private channel (`conversations.list`) and every one he is in. */
	const findChannels = async (text) => {
		const wanted = text.trim().replace(/^#/, "").toLowerCase();
		if (!wanted) return {
			ok: true,
			channels: []
		};
		if (!everything || now() - everything.at >= LIST_TTL_MS) {
			const listed = await pages("conversations.list", {
				types: "public_channel,private_channel",
				exclude_archived: "true"
			});
			if (!listed.ok) return listed;
			everything = {
				at: now(),
				rows: listed.rows
			};
		}
		const mine = await memberRows();
		return {
			ok: true,
			channels: [...new Map([...everything.rows, ...mine.ok ? mine.rows : []].map((row) => [row.id, row])).values()].map((row) => ({
				row,
				name: row.is_im && row.user ? users.get(row.user) ?? "" : row.is_mpim && row.name ? groupName(row.name, me()) : row.name ?? ""
			})).filter(({ name }) => name.toLowerCase().includes(wanted)).sort((a, b) => Number(!a.name.toLowerCase().startsWith(wanted)) - Number(!b.name.toLowerCase().startsWith(wanted))).slice(0, FOUND_MAX).map(({ row, name }) => ({
				id: row.id,
				name,
				kind: kindOf(row),
				unread: null,
				more: false,
				mentions: 0,
				latest: null,
				url: slackLink(teamUrl(), row.id)
			}))
		};
	};
	/** A `search.messages` match as a hit: its conversation named (a direct message by its person), its thread found. */
	const hitOf = async (match) => {
		const where = match.channel;
		let row = names.get(where.id);
		if (!row) {
			const im = match.type === "im" || where.is_im === true;
			row = {
				id: where.id,
				...im ? {
					is_im: true,
					user: where.name
				} : { name: where.name },
				is_mpim: where.is_mpim === true || match.type === "mpim",
				is_private: where.is_private === true
			};
			names.set(where.id, row);
		}
		let thread = match.thread_ts ?? null;
		if (!thread && match.permalink) try {
			thread = new URL(match.permalink).searchParams.get("thread_ts");
		} catch {
			thread = null;
		}
		return {
			channel: {
				id: where.id,
				name: await nameOf(row, where.id),
				kind: kindOf(row)
			},
			ts: match.ts,
			threadTs: thread && TS.test(thread) && thread !== match.ts ? thread : null,
			name: match.user ? await userName(match.user) : match.username ?? "someone",
			at: Math.round(Number(match.ts) * 1e3),
			excerpt: excerptOf(await plain(match.text ?? "")),
			url: match.permalink ?? slackLink(teamUrl(), where.id, match.ts)
		};
	};
	const slack = {
		async check(session) {
			const answer = await call("auth.test", {}, session);
			if (!answer.ok) return answer;
			const text = (key) => typeof answer.json[key] === "string" ? answer.json[key] : null;
			return {
				ok: true,
				team: text("team"),
				url: text("url"),
				user: text("user")
			};
		},
		async unread() {
			const counts = await call("client.counts", {
				thread_counts_by_channel: "true",
				org_wide_aware: "true",
				include_file_channels: "true"
			});
			if (!counts.ok) return counts;
			const rows = [
				...counts.json.channels ?? [],
				...counts.json.mpims ?? [],
				...counts.json.ims ?? []
			];
			for (const row of rows) if (row.last_read) lastRead.set(row.id, row.last_read);
			const unreadRows = rows.filter((row) => row.has_unreads);
			unreadRows.sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0) || Number(b.latest ?? 0) - Number(a.latest ?? 0));
			await memberRows();
			return {
				ok: true,
				channels: await Promise.all(unreadRows.map(async (row, index) => {
					const known = names.get(row.id);
					let unread = null;
					let more = false;
					if (index < 30) {
						const history = await call("conversations.history", {
							channel: row.id,
							limit: String(COUNT_LIMIT),
							...row.last_read && row.last_read !== "0000000000.000000" ? { oldest: row.last_read } : {}
						});
						if (history.ok) {
							unread = (history.json.messages ?? []).length;
							more = history.json.has_more === true;
						}
					}
					return {
						id: row.id,
						name: await nameOf(known, row.id),
						kind: kindOf(names.get(row.id)),
						unread,
						more,
						mentions: row.mention_count ?? 0,
						latest: row.latest ?? null,
						url: slackLink(teamUrl(), row.id)
					};
				}))
			};
		},
		async search(text, page = 1) {
			const query = text.trim();
			if (!query) return {
				ok: true,
				channels: [],
				hits: [],
				page: 1,
				pages: 0,
				total: 0
			};
			const at = Math.min(SEARCH_PAGES_MAX, Math.max(1, Math.floor(page) || 1));
			const [found, named] = await Promise.all([call("search.messages", {
				query,
				count: String(SEARCH_COUNT),
				page: String(at),
				highlight: "true",
				sort: "score",
				sort_dir: "desc"
			}), at === 1 ? findChannels(query) : Promise.resolve(void 0)]);
			if (!found.ok) return found;
			const box = found.json.messages;
			const matches = (box?.matches ?? []).filter((match) => !!match.channel?.id && ID.test(match.channel.id) && !!match.ts && TS.test(match.ts));
			const hits = await Promise.all(matches.map(hitOf));
			return {
				ok: true,
				channels: named?.ok ? named.channels : [],
				hits,
				page: box?.paging?.page ?? at,
				pages: Math.min(SEARCH_PAGES_MAX, box?.paging?.pages ?? 1),
				total: box?.paging?.total ?? box?.total ?? hits.length
			};
		},
		async conversations() {
			members = void 0;
			const listed = await memberRows();
			if (!listed.ok) return listed;
			const counts = await call("client.counts", {
				thread_counts_by_channel: "true",
				org_wide_aware: "true",
				include_file_channels: "true"
			});
			const countOf = /* @__PURE__ */ new Map();
			if (counts.ok) for (const key of [
				"channels",
				"mpims",
				"ims"
			]) for (const row of counts.json[key] ?? []) {
				countOf.set(row.id, row);
				if (row.last_read) lastRead.set(row.id, row.last_read);
			}
			const channels = await atMost(listed.rows.filter((row) => !(row.is_im && row.is_user_deleted)), NAMING_AT_ONCE, async (row) => {
				const count = countOf.get(row.id);
				return {
					id: row.id,
					name: await nameOf(row, row.id),
					kind: kindOf(row),
					unread: null,
					more: false,
					mentions: count?.mention_count ?? 0,
					latest: count?.latest ?? null,
					url: slackLink(teamUrl(), row.id),
					...counts.ok ? { unreads: count?.has_unreads === true } : {}
				};
			});
			const people = (channel) => Number(channel.kind === "dm" || channel.kind === "group");
			channels.sort((a, b) => people(a) - people(b) || a.name.localeCompare(b.name, void 0, { sensitivity: "base" }));
			return {
				ok: true,
				channels
			};
		},
		async channel(id, at) {
			if (!ID.test(id) || at !== void 0 && !TS.test(at)) return badChannel;
			let rows;
			let newer;
			if (at) {
				const [before, after] = await Promise.all([call("conversations.history", {
					channel: id,
					latest: at,
					inclusive: "true",
					limit: String(AROUND_BEFORE)
				}), call("conversations.history", {
					channel: id,
					oldest: at,
					limit: String(AROUND_AFTER)
				})]);
				if (!before.ok) return before;
				const complete = after.ok && after.json.has_more !== true;
				const both = [...before.json.messages ?? [], ...complete ? after.json.messages ?? [] : []];
				rows = [...new Map(both.map((row) => [row.ts, row])).values()].sort(byTs);
				newer = !complete;
			} else {
				const history = await call("conversations.history", {
					channel: id,
					limit: String(CHANNEL_MESSAGES)
				});
				if (!history.ok) return history;
				rows = [...history.json.messages ?? []].reverse();
			}
			let read = lastRead.get(id);
			if (read === void 0) {
				const info = await call("conversations.info", { channel: id });
				const row = info.ok ? info.json.channel : void 0;
				if (row) names.set(id, {
					...names.get(id),
					...row
				});
				read = row?.last_read;
			}
			return {
				ok: true,
				thread: {
					channel: {
						id,
						name: await slack.channelName(id)
					},
					messages: await messages(rows),
					url: slackLink(teamUrl(), id),
					lastRead: read && read !== "0000000000.000000" ? read : null,
					...newer === void 0 ? {} : { newer }
				}
			};
		},
		async thread(id, ts) {
			if (!ID.test(id) || !TS.test(ts)) return badChannel;
			const replies = await call("conversations.replies", {
				channel: id,
				ts,
				limit: String(THREAD_MESSAGES)
			});
			if (!replies.ok) return replies;
			const rows = replies.json.messages ?? [];
			return {
				ok: true,
				thread: {
					channel: {
						id,
						name: await slack.channelName(id)
					},
					messages: await messages(rows),
					url: slackLink(teamUrl(), id, ts),
					lastRead: rows.find((row) => row.ts === ts)?.last_read ?? null
				}
			};
		},
		channelName: (id) => nameOf(names.get(id), id),
		async reply(channel, threadTs, text) {
			if (!ID.test(channel) || !TS.test(threadTs)) return badChannel;
			const posted = await call("chat.postMessage", {
				channel,
				thread_ts: threadTs,
				text
			});
			if (!posted.ok) return posted;
			const ts = typeof posted.json.ts === "string" ? posted.json.ts : void 0;
			return {
				ok: true,
				url: ts ? `${slackLink(teamUrl(), channel, ts)}?thread_ts=${threadTs}&cid=${channel}` : null
			};
		},
		async markRead(channel, ts, threadTs) {
			if (!ID.test(channel) || !TS.test(ts) || threadTs !== void 0 && !TS.test(threadTs)) return badChannel;
			const marked = threadTs ? await call("subscriptions.thread.mark", {
				channel,
				thread_ts: threadTs,
				ts,
				read: "1"
			}) : await call("conversations.mark", {
				channel,
				ts
			});
			if (!marked.ok) return marked;
			if (!threadTs) lastRead.set(channel, ts);
			return {
				ok: true,
				url: slackLink(teamUrl(), channel, threadTs)
			};
		}
	};
	return slack;
}
//#endregion
//#region apps/agent-world/src/backend/integrations/index.ts
var PREVIEW = 80;
var preview = (text) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > PREVIEW ? `${flat.slice(0, 79)}\u2026` : flat;
};
function openIntegrations(options) {
	const files = integrationFiles(options.stateDir);
	const credentials = openCredentials(files.credentials);
	const atlassian = () => credentials.read().atlassian;
	const github = openGitHub(options.env);
	const jira = openJira(atlassian, options.fetch);
	const confluence = openConfluence(atlassian, files.recentPages, options.fetch, options.now);
	const slack = openSlack(() => credentials.read().slack, {
		api: options.slackApi,
		fetch: options.fetch,
		now: options.now
	});
	const characters = () => options.snapshot().characters;
	/** Mark read, described for the record: the channel, or the thread by who started it. */
	const describeMarkRead = async (intent) => {
		const ts = /^\d+\.\d+$/;
		if (!/^[A-Z0-9]+$/.test(intent.channel) || !ts.test(intent.ts) || intent.threadTs !== void 0 && !ts.test(intent.threadTs)) return {
			ok: false,
			reason: "That is not a Slack channel."
		};
		if (!credentials.read().slack) return {
			ok: false,
			reason: "Sign in to Slack in Settings first.",
			signIn: "slack"
		};
		const channel = await slack.channelName(intent.channel);
		const place = /^[CG]/.test(intent.channel) ? `#${channel}` : channel;
		let where = place;
		if (intent.threadTs) {
			const parent = await slack.thread(intent.channel, intent.threadTs);
			if (!parent.ok) return parent;
			const first = parent.thread.messages[0];
			where = `${place}, in ${first ? `${first.name}'s` : "a"} thread`;
		}
		return {
			ok: true,
			description: {
				what: "Mark read in Slack",
				where,
				text: "",
				url: null
			}
		};
	};
	const gate = openGate(files.record, {
		async describe(intent) {
			switch (intent.kind) {
				case "github-review":
					if (!validPullRequest(intent.repo, intent.number)) return {
						ok: false,
						reason: "That is not a pull request."
					};
					return {
						ok: true,
						description: {
							what: {
								approve: "Approve pull request",
								comment: "Comment on pull request",
								"request-changes": "Request changes on pull request"
							}[intent.event],
							where: `${intent.repo}#${intent.number} on GitHub`,
							text: intent.body,
							url: `https://github.com/${intent.repo}/pull/${intent.number}`
						}
					};
				case "jira-comment":
				case "jira-transition": {
					const signedIn = atlassian();
					if (!signedIn) return NOT_SIGNED_IN$1;
					const key = issueKey(intent.key);
					if (!key) return {
						ok: false,
						reason: "That is not a Jira issue key."
					};
					const where = `${key} on ${new URL(signedIn.site).hostname}`;
					const url = `${signedIn.site}/browse/${key}`;
					if (intent.kind === "jira-comment") return {
						ok: true,
						description: {
							what: "Comment on Jira issue",
							where,
							text: intent.body,
							url
						}
					};
					const allowed = await jira.transitions(key);
					if (!allowed.ok) return allowed;
					const move = allowed.transitions.find((transition) => transition.id === intent.transition);
					if (!move) return {
						ok: false,
						reason: `Jira does not offer that move for ${key} now.`
					};
					return {
						ok: true,
						description: {
							what: "Move Jira issue",
							where,
							text: move.to && move.to !== move.name ? `${move.name} (to ${move.to})` : move.name,
							url
						}
					};
				}
				case "slack-reply": {
					if (!credentials.read().slack) return {
						ok: false,
						reason: "Sign in to Slack in Settings first.",
						signIn: "slack"
					};
					const parent = await slack.thread(intent.channel, intent.threadTs);
					if (!parent.ok) return parent;
					const first = parent.thread.messages[0];
					const channel = await slack.channelName(intent.channel);
					const place = /^[CG]/.test(intent.channel) ? `#${channel}` : channel;
					return {
						ok: true,
						description: {
							what: "Reply in a Slack thread",
							where: first ? `${place}, in ${first.name}'s thread: ${preview(first.text)}` : place,
							text: intent.text,
							url: parent.thread.url
						}
					};
				}
				case "slack-mark-read": return describeMarkRead(intent);
			}
		},
		async send(intent) {
			switch (intent.kind) {
				case "github-review": return github.review(intent.repo, intent.number, intent.event, intent.body);
				case "jira-comment": return jira.comment(intent.key, intent.body);
				case "jira-transition": return jira.transition(intent.key, intent.transition);
				case "slack-reply": return slack.reply(intent.channel, intent.threadTs, intent.text);
				case "slack-mark-read": return slack.markRead(intent.channel, intent.ts, intent.threadTs);
			}
		}
	}, options.now);
	return {
		credentialStatus: () => credentials.status(),
		async signInAtlassian(site, email, token) {
			const origin = typeof site === "string" ? atlassianSite(site) : void 0;
			if (!origin) return {
				ok: false,
				reason: "That is not an Atlassian site address."
			};
			if (typeof email !== "string" || !email.includes("@")) return {
				ok: false,
				reason: "That is not an email address."
			};
			if (typeof token !== "string" || !token.trim()) return {
				ok: false,
				reason: "Paste the API token first."
			};
			const trying = {
				site: origin,
				email: email.trim(),
				token: token.trim()
			};
			const me = await openJira(() => trying, options.fetch).myself();
			if (!me.ok) return me;
			credentials.set("atlassian", trying);
			return {
				ok: true,
				name: me.name
			};
		},
		async signOutAtlassian() {
			credentials.set("atlassian", void 0);
			return { ok: true };
		},
		/** Keep a Slack session captured from the sign-in window, once `auth.test` accepts it. */
		async storeSlackSession(session) {
			if (!session.token.startsWith("xoxc-") || !session.cookie) return {
				ok: false,
				reason: "Slack's sign-in did not finish."
			};
			const checked = await slack.check(session);
			if (!checked.ok) return {
				ok: false,
				reason: "Slack did not accept the captured session."
			};
			credentials.set("slack", {
				token: session.token,
				cookie: session.cookie,
				team: checked.team,
				url: checked.url,
				user: checked.user
			});
			return {
				ok: true,
				team: checked.team
			};
		},
		async signOutSlack() {
			credentials.set("slack", void 0);
			return { ok: true };
		},
		pullRequests: () => github.pullRequests(characters()),
		pullRequest: (repo, number) => validPullRequest(repo, number) ? github.pullRequest(repo, number, characters()) : Promise.resolve({
			ok: false,
			reason: "That is not a pull request."
		}),
		jiraAssigned: () => jira.assigned(),
		jiraSearch: (text) => jira.search(typeof text === "string" ? text : ""),
		jiraIssue: (key) => jira.issue(String(key ?? "")),
		jiraTransitions: (key) => jira.transitions(String(key ?? "")),
		confluenceSearch: (text) => confluence.search(typeof text === "string" ? text : ""),
		confluencePage: (id) => confluence.page(String(id ?? "")),
		libraryRecent: () => confluence.recent(),
		slackUnread: () => slack.unread(),
		slackSearch: (text, page) => slack.search(typeof text === "string" ? text : "", typeof page === "number" ? page : 1),
		slackConversations: () => slack.conversations(),
		slackChannel: (id, at) => slack.channel(String(id ?? ""), at == null ? void 0 : String(at)),
		slackThread: (id, ts) => slack.thread(String(id ?? ""), String(ts ?? "")),
		/** Mark read: the button is the operator's choice, so the gate sends it unconfirmed but records it. */
		slackMarkRead: (id, ts, threadTs) => gate.act({
			kind: "slack-mark-read",
			channel: id,
			ts,
			...threadTs == null ? {} : { threadTs }
		}),
		describeWrite: (intent) => gate.describe(intent),
		confirmWrite: (intent, token) => gate.write(intent, token),
		outsideWrites: async () => gate.recent(),
		onOutsideWrite: (listener) => gate.onWrite(listener),
		/** Delegate an item to an agent; each receipt stage reaches `onReceipt`. */
		delegate: (commandId, delegation, onReceipt = () => {}) => typeof commandId === "string" && commandId ? delegate(options.commands, options.snapshot(), commandId, delegation, (characterId, stage, reason) => onReceipt({
			commandId,
			characterId,
			stage,
			...reason ? { reason } : {}
		})) : Promise.resolve({
			ok: false,
			reason: "No command id was given."
		}),
		close() {}
	};
}
//#endregion
//#region apps/agent-world/src/backend/integrations/slack-sign-in.ts
var SLACK_SIGN_IN_URL = "https://app.slack.com/";
var POLL_MS = 1e3;
/** The operator has this long to finish signing in (SSO and two-factor included). */
var SIGN_IN_MS = 9e5;
/** Runs in the Slack page: the current team's token from the web client's local configuration, or null. */
var READ_TOKEN = `(() => {
	try {
		const config = JSON.parse(localStorage.getItem("localConfig_v2") || "null");
		if (!config || !config.teams) return null;
		const match = location.pathname.match(/^\\/client\\/([A-Z0-9]+)/);
		const id = (match && match[1]) || config.lastActiveTeamId || Object.keys(config.teams)[0];
		const team = id && config.teams[id];
		return team && typeof team.token === "string" && team.token.startsWith("xoxc-") ? team.token : null;
	} catch {
		return null;
	}
})()`;
/**
* Wait until the window holds a signed-in Slack web session, then close it and resolve with the token and `d`
* cookie; undefined when the operator closed the window first or the time ran out.
*/
function captureSlackSession(window) {
	return new Promise((resolve) => {
		let done = false;
		const finish = (session) => {
			if (done) return;
			done = true;
			clearInterval(timer);
			clearTimeout(limit);
			if (!window.isDestroyed()) window.close();
			resolve(session);
		};
		const look = async () => {
			if (done || window.isDestroyed()) return;
			try {
				const token = await window.webContents.executeJavaScript(READ_TOKEN);
				if (typeof token !== "string") return;
				const [cookie] = await window.webContents.session.cookies.get({
					url: SLACK_SIGN_IN_URL,
					name: "d"
				});
				if (cookie?.value) finish({
					token,
					cookie: cookie.value
				});
			} catch {}
		};
		const timer = setInterval(() => void look(), POLL_MS);
		const limit = setTimeout(() => finish(void 0), SIGN_IN_MS);
		window.once("closed", () => finish(void 0));
	});
}
//#endregion
//#region apps/agent-world/src/electron/integrations-ipc.ts
function wireIntegrations(options) {
	const integrations = openIntegrations(options);
	const handle = (channel, listener) => ipcMain.handle(`places:${channel}`, (_event, ...args) => listener(...args));
	handle("credential-status", () => integrations.credentialStatus());
	handle("sign-in-atlassian", (site, email, token) => integrations.signInAtlassian(site, email, token));
	handle("sign-out-atlassian", () => integrations.signOutAtlassian());
	let signingIn;
	handle("sign-in-slack", () => {
		signingIn ??= (async () => {
			const window = new BrowserWindow({
				width: 1e3,
				height: 760,
				title: "Sign in to Slack",
				backgroundColor: "#ffffff",
				webPreferences: {
					partition: "persist:agent-world-slack",
					contextIsolation: true,
					sandbox: true,
					nodeIntegration: false
				}
			});
			window.webContents.setUserAgent(window.webContents.getUserAgent().replace(/ (Electron|Agent ?World)\/\S+/gi, ""));
			window.loadURL(SLACK_SIGN_IN_URL);
			const session = await captureSlackSession(window);
			if (!session) return {
				ok: false,
				reason: "Slack's sign-in window closed before you signed in."
			};
			return integrations.storeSlackSession(session);
		})().finally(() => {
			signingIn = void 0;
		});
		return signingIn;
	});
	handle("sign-out-slack", () => integrations.signOutSlack());
	handle("pull-requests", () => integrations.pullRequests());
	handle("pull-request", (repo, number) => integrations.pullRequest(repo, number));
	handle("jira-assigned", () => integrations.jiraAssigned());
	handle("jira-search", (text) => integrations.jiraSearch(text));
	handle("jira-issue", (key) => integrations.jiraIssue(key));
	handle("jira-transitions", (key) => integrations.jiraTransitions(key));
	handle("confluence-search", (text) => integrations.confluenceSearch(text));
	handle("confluence-page", (id) => integrations.confluencePage(id));
	handle("library-recent", () => integrations.libraryRecent());
	handle("slack-unread", () => integrations.slackUnread());
	handle("slack-search", (text, page) => integrations.slackSearch(text, page));
	handle("slack-conversations", () => integrations.slackConversations());
	handle("slack-channel", (id, at) => integrations.slackChannel(id, at));
	handle("slack-thread", (id, ts) => integrations.slackThread(id, ts));
	handle("slack-mark-read", (id, ts, threadTs) => integrations.slackMarkRead(id, ts, threadTs));
	handle("describe-write", (intent) => integrations.describeWrite(intent));
	handle("confirm-write", (intent, token) => integrations.confirmWrite(intent, token));
	handle("outside-writes", () => integrations.outsideWrites());
	integrations.onOutsideWrite((entry) => options.toWindow("places:outside-write", entry));
	handle("delegate", (commandId, delegation) => integrations.delegate(commandId, delegation, (receipt) => options.toWindow("world:receipt", receipt)));
	return integrations;
}
//#endregion
//#region apps/agent-world/src/electron/main.ts
var appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** How long the capture waits for a place to draw, and then for its art to settle. */
var CAPTURE_WAIT_MS = 2e4;
var CAPTURE_DELAY_MS = 1500;
app.setName("Agent World");
app.setPath("userData", join(agentDir(), "agent-world", "electron-data"));
protocol.registerSchemesAsPrivileged([{
	scheme: "app",
	privileges: {
		standard: true,
		secure: true,
		supportFetchAPI: true
	}
}]);
if (app.requestSingleInstanceLock()) start();
else app.quit();
/**
* The capture hook: once a place scene has drawn its painting (or after `CAPTURE_WAIT_MS`), write the window as a
* PNG, print which place it shows, and quit.
*/
async function captureWhenDrawn(window, file) {
	const drawn = `(() => { const v = window.agentWorldView; const p = v && v.place(); return p && v.painting() ? p : ""; })()`;
	const until = Date.now() + CAPTURE_WAIT_MS;
	let place = "";
	while (!window.isDestroyed() && Date.now() < until) {
		place = String(await window.webContents.executeJavaScript(drawn).catch(() => "") ?? "");
		if (place) break;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	await new Promise((resolve) => setTimeout(resolve, CAPTURE_DELAY_MS));
	const image = !window.isDestroyed() ? await window.webContents.capturePage() : void 0;
	if (image) writeFileSync(file, image.toPNG());
	console.log(`agent-world capture: ${place ? `place ${place}` : "no place drew"}`);
	app.quit();
}
function start() {
	const world = openWorldBackend(statePaths());
	const conversations = openConversations(statePaths().socket);
	const commands = openCommands(statePaths().socket);
	let window;
	const toWindow = (channel, message) => {
		if (window && !window.isDestroyed()) window.webContents.send(channel, message);
	};
	ipcMain.handle("world:snapshot", () => world.snapshot());
	ipcMain.handle("world:feed", () => world.feed());
	ipcMain.handle("world:terminal", (_event, characterId) => typeof characterId === "string" ? world.goToTerminal(characterId) : {
		ok: false,
		reason: "No character was named."
	});
	ipcMain.handle("world:conversation", (_event, characterId, before) => typeof characterId === "string" ? conversations.page(characterId, typeof before === "string" ? before : void 0) : {
		ok: false,
		reason: "No character was named."
	});
	ipcMain.handle("world:mark-seen", (_event, characterId) => typeof characterId === "string" ? conversations.markSeen(characterId) : {
		ok: false,
		reason: "No character was named."
	});
	ipcMain.handle("world:avatar-look", (_event, look) => typeof look === "string" ? world.setAvatarLook(look) : {
		ok: false,
		reason: "No look was named."
	});
	ipcMain.handle("world:themes", () => listThemes(join(appDir, "themes")));
	ipcMain.handle("world:set-theme", (_event, id) => {
		if (typeof id !== "string") return {
			ok: false,
			reason: "No theme was named."
		};
		if (window && !window.isDestroyed()) window.setBackgroundColor(themeBackdrop(join(appDir, "themes"), id));
		return world.setTheme(id);
	});
	ipcMain.handle("world:instruct", (_event, characterId, commandId, instruction) => {
		if (typeof characterId !== "string" || typeof commandId !== "string" || !commandId) return {
			ok: false,
			reason: "No character was named."
		};
		const character = world.snapshot().characters.find((c) => c.id === characterId);
		return instruct(commands, character, commandId, instruction, (stage, reason) => toWindow("world:receipt", {
			commandId,
			characterId,
			stage,
			...reason ? { reason } : {}
		}));
	});
	ipcMain.handle("world:watch-replies", (_event, characterIds) => conversations.watch(Array.isArray(characterIds) ? characterIds.filter((id) => typeof id === "string") : []));
	conversations.onReply((event) => toWindow("world:reply", event));
	const lifecycle = openLifecycle(statePaths(), commands, () => world.snapshot());
	const unnamed = {
		ok: false,
		reason: "No character was named."
	};
	ipcMain.handle("world:wake", (_event, characterId) => typeof characterId === "string" ? lifecycle.wake(characterId) : unnamed);
	ipcMain.handle("world:end-session", (_event, characterId, confirmed) => typeof characterId === "string" ? lifecycle.endSession(characterId, confirmed === true) : unnamed);
	ipcMain.handle("world:send-mail", (_event, characterId, body) => typeof characterId === "string" && typeof body === "string" ? lifecycle.sendMail(characterId, body) : unnamed);
	ipcMain.handle("world:recruit", (_event, request) => {
		const { name, cwd, brief, reportsTo } = request ?? {};
		if (typeof name !== "string" || typeof cwd !== "string" || typeof brief !== "string") return {
			ok: false,
			reason: "The recruit needs a name, a directory, and a brief."
		};
		return lifecycle.recruit({
			name,
			cwd,
			brief,
			...typeof reportsTo === "string" ? { reportsTo } : {}
		});
	});
	ipcMain.handle("world:rename", (_event, characterId, name) => typeof characterId === "string" && typeof name === "string" ? lifecycle.rename(characterId, name) : unnamed);
	wireIntegrations({
		stateDir: statePaths().dir,
		snapshot: () => world.snapshot(),
		commands,
		toWindow
	});
	ipcMain.handle("world:open-link", (_event, url) => openLink(url, (href) => shell.openExternal(href)));
	const toUpdate = leaveOutUnchanged();
	world.subscribe((snapshot) => {
		if (window && !window.isDestroyed()) window.webContents.send("world:update", toUpdate(snapshot));
	});
	world.subscribeFeed((lines) => {
		if (window && !window.isDestroyed()) window.webContents.send("world:feed", lines);
	});
	app.on("second-instance", () => {
		if (!window) return;
		if (window.isMinimized()) window.restore();
		window.show();
		window.focus();
	});
	app.on("window-all-closed", () => app.quit());
	app.on("will-quit", () => {
		world.close();
		conversations.close();
		commands.close();
	});
	app.whenReady().then(() => {
		protocol.handle("app", (request) => {
			const file = appFile(appDir, new URL(request.url).pathname);
			return file ? net.fetch(pathToFileURL(file).href) : new Response("not found", { status: 404 });
		});
		window = new BrowserWindow({
			width: 1280,
			height: 800,
			title: "Agent World",
			backgroundColor: themeBackdrop(join(appDir, "themes"), world.snapshot().theme),
			webPreferences: {
				preload: join(appDir, "dist", "electron", "preload.cjs"),
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false
			}
		});
		window.on("closed", () => {
			window = void 0;
		});
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		window.webContents.on("will-navigate", (event) => event.preventDefault());
		window.loadURL("app://world/index.html");
		const capture = process.env.AGENT_WORLD_CAPTURE;
		if (capture) window.webContents.once("did-finish-load", () => window && void captureWhenDrawn(window, capture));
	});
}
//#endregion
export {};

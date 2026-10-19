import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWindow, app, ipcMain, net, protocol } from "electron";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
//#region apps/agent-world/src/world.ts
/** Longest text of one transcript field sent to the world UI. */
var TRANSCRIPT_TEXT_MAX = 2e4;
//#endregion
//#region apps/agent-world/src/backend/transcript.ts
/** The custom message type of delivered mail (`components/session-state/src/mail.ts`). */
var MAIL = "apple-pi.mailbox-message";
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
		if (label === MAIL) return {
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
		close() {
			closed = true;
			socket?.destroy();
		}
	};
}
//#endregion
//#region apps/agent-world/src/backend/facts.ts
/** The facts columns for `select ... from sessions s join incarnations i ...` (the current incarnation). */
var FACTS_COLUMNS = `s.run_state as runState, s.prompt, s.needs_you_since as needsYouSince, s.seen_at as seenAt,
	s.settled_at as settledAt, s.current_tool as currentTool, s.current_tool_arg as currentToolArg,
	s.current_tool_since as currentToolSince, s.current_task as currentTask, s.model, s.context_tokens as contextTokens,
	s.context_window as contextWindow, s.cost, i.tmux_socket as tmuxSocket, i.pane_id as paneId,
	(select ts.name from tmux_window_links l join tmux_sessions ts on ts.socket = l.socket and ts.id = l.session_id
		where l.socket = p.socket and l.window_id = p.window_id order by l.window_index limit 1) as tmuxSession,
	(select l.window_index from tmux_window_links l
		where l.socket = p.socket and l.window_id = p.window_id order by l.window_index limit 1) as windowIndex`;
/** Joins for `FACTS_COLUMNS`: the session's current incarnation `i` and its pane `p`. */
var FACTS_JOINS = `left join incarnations i on i.session_id = s.id and i.generation = s.generation
left join tmux_panes p on p.socket = i.tmux_socket and p.id = i.pane_id`;
function parse$2(json) {
	if (!json) return void 0;
	try {
		return JSON.parse(json);
	} catch {
		return;
	}
}
var text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
/** The open prompt's kind and what it asks: its title, or else its first question. */
function asking(prompt) {
	if (prompt === null) return null;
	const open = parse$2(prompt);
	const first = Array.isArray(open?.questions) ? open.questions[0] : void 0;
	return {
		kind: text(open?.kind) ?? "dialog",
		text: text(open?.title) ?? text(first?.question)
	};
}
/** Reads ledger tasks' `task.md`, again only when the file changed. */
function taskReader() {
	const cache = /* @__PURE__ */ new Map();
	return (currentTask) => {
		const task = parse$2(currentTask);
		if (typeof task?.bundle !== "string" || typeof task.taskId !== "string") return null;
		const file = join(task.bundle, "task.md");
		let read = cache.get(file);
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
			read = void 0;
			cache.delete(file);
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
	const git = parse$2(row.git);
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
var PREVIEW = 120;
function preview(text) {
	const flat = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
	return flat.length > PREVIEW ? `${flat.slice(0, 119)}\u2026` : flat;
}
function parse$1(json) {
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
	if (command.kind === "rename") return preview(command.name);
	if (command.kind === "set_model") return preview(command.id);
	if (command.kind === "set_thinking") return preview(command.level);
	return preview(command.text ?? command.prompt);
}
/** The line for one event, or undefined when it is not one the operator follows. */
function feedLine(row, lookup) {
	if (row.sessionKind === "child") return void 0;
	const name = row.name || (row.cwd ? basename(row.cwd) : null) || row.sessionId;
	const data = parse$1(row.data);
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
			const asks = preview(prompt.title ?? first?.question);
			return line("agents", asks ? `${name} asks: ${asks}` : `${name} asks you something.`);
		}
		case "prompt_closed": return line("agents", `${name}'s question was answered.`);
		case "command_accepted": {
			const command = data.command ?? {};
			if (command.kind === "mail") return line("mail", `Mail from ${typeof command.from === "string" ? lookup.name(command.from) ?? command.from : "someone"} to ${name}: ${preview(command.body)}`);
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
			if (row.type === "command_failed") return line("commands", `${label} for ${name} failed: ${preview(data.reason) || "no reason given"}.`);
			return command?.kind === "start" ? void 0 : line("commands", `${name} took the ${label.toLowerCase()}.`);
		}
	}
}
//#endregion
//#region apps/agent-world/src/backend/projection.ts
var byStart = (a, b) => (a.firstStartedAt ?? Number.MAX_SAFE_INTEGER) - (b.firstStartedAt ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/**
* A coordinator was started with `--coordinator` or has a session reporting to it; a worker reports to one; any
* other session is independent. Each awake coordinator, and each coordinator with an awake worker, has a
* headquarters. Workers stand in the wing of their repository, or the common room outside one; independents stand
* in the square. Dormant sessions are in no awake place.
*/
function projectWorld(sessions, remembered) {
	const byId = new Map(sessions.map((session) => [session.id, session]));
	const coordinators = /* @__PURE__ */ new Set();
	for (const session of sessions) {
		if (session.coordinatorFlag) coordinators.add(session.id);
		if (session.reportsTo && session.reportsTo !== session.id) coordinators.add(session.reportsTo);
	}
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
			name: session.name || basename(session.cwd) || session.id,
			role,
			place,
			startedAt: session.firstStartedAt ?? 0
		};
	});
	const shown = /* @__PURE__ */ new Set();
	for (const character of characters) if (character.place.kind !== "square") shown.add(character.place.headquarters);
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
		wings
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
/** How often new `events` rows are looked for; updates must reach the world within a second. */
var POLL_MS = 200;
var RECONNECT_MS = 1e3;
/** Polls between rereads of the world while no event arrives, so edited `task.md` files show. */
var TASK_REREAD_POLLS = 10;
var FEED_BACKLOG_EVENTS = 5e3;
/** After a failed preference write, wait this long before sending it again. */
var RETRY_MS = 5e3;
/** How long choosing a look waits for the runtime to store it. */
var STORE_TIMEOUT_MS = 5e3;
/**
* The `preferences` key Agent World keeps its choices under:
* `{ wings: { [coordinator id]: repository[] }, avatar: look }`.
*/
var PREFERENCE_KEY = "agent-world";
var SESSIONS = `
select s.id, s.name, s.cwd, s.reports_to as reportsTo, s.git, s.config,
	(select min(f.started_at) from incarnations f where f.session_id = s.id) as firstStartedAt,
	coalesce(i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost'), 0) as awake,
	${FACTS_COLUMNS}
from sessions s
${FACTS_JOINS}
where s.kind = 'root'`;
function parse(json) {
	if (!json) return void 0;
	try {
		return JSON.parse(json);
	} catch {
		return;
	}
}
function sessionRow(row) {
	const git = parse(row.git);
	const config = parse(row.config);
	return {
		id: row.id,
		name: row.name,
		cwd: row.cwd,
		reportsTo: row.reportsTo,
		repository: typeof git?.repository === "string" ? git.repository : null,
		coordinatorFlag: Array.isArray(config?.flags) && config.flags.includes("coordinator"),
		awake: row.awake === 1,
		firstStartedAt: row.firstStartedAt ?? void 0
	};
}
/** Each coordinator's wings: those in `first`, then any in `then` not among them, in order. */
function mergeWings(first, then) {
	const merged = {};
	for (const id of /* @__PURE__ */ new Set([...Object.keys(first), ...Object.keys(then)])) merged[id] = [.../* @__PURE__ */ new Set([...first[id] ?? [], ...then[id] ?? []])];
	return merged;
}
function openWorldBackend(paths) {
	const listeners = /* @__PURE__ */ new Set();
	let current = {
		connected: false,
		headquarters: [],
		characters: []
	};
	let world;
	let db;
	let socket;
	let socketOpen = false;
	let lastSeq = -1;
	let closed = false;
	let seen = {};
	let sending;
	let chosenAvatar;
	let storedAvatar = null;
	const avatarWaiters = /* @__PURE__ */ new Set();
	const settleAvatar = (result) => {
		for (const waiter of avatarWaiters) waiter(result);
		avatarWaiters.clear();
	};
	let retryAt = 0;
	const readTask = taskReader();
	let polls = 0;
	const feedListeners = /* @__PURE__ */ new Set();
	let recent = [];
	let feedSeq;
	const publish = (next) => {
		if (JSON.stringify(next) === JSON.stringify(current)) return;
		current = next;
		for (const listener of listeners) listener(current);
	};
	const openDb = () => {
		if (db || !existsSync(paths.db)) return;
		db = new DatabaseSync(paths.db);
		db.exec("pragma query_only = 1");
		lastSeq = -1;
	};
	const dropDb = () => {
		db?.close();
		db = void 0;
	};
	const storedPreference = (database) => {
		const value = parse(database.prepare("select value from preferences where key = ?").get(PREFERENCE_KEY)?.value);
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	};
	/**
	* Send the wings and the chosen avatar look to the runtime when they differ from what it stored, keeping the
	* preference's other keys.
	*/
	const remember = (stored, storedWings, wings) => {
		const next = mergeWings(storedWings, wings);
		storedAvatar = typeof stored.avatar === "string" ? stored.avatar : null;
		if (chosenAvatar !== void 0 && chosenAvatar === storedAvatar) {
			chosenAvatar = void 0;
			settleAvatar({ ok: true });
		}
		if (JSON.stringify(next) === JSON.stringify(storedWings) && chosenAvatar === void 0) {
			sending = void 0;
			return;
		}
		const value = {
			...stored,
			wings: next,
			...chosenAvatar === void 0 ? {} : { avatar: chosenAvatar }
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
	const read = () => {
		openDb();
		if (!db) return void 0;
		try {
			const { seq } = db.prepare("select coalesce(max(seq), 0) as seq from events").get();
			if (seq === lastSeq && world) return world;
			lastSeq = seq;
			const rows = db.prepare(SESSIONS).all();
			const stored = storedPreference(db);
			const storedWings = stored.wings && typeof stored.wings === "object" ? stored.wings : {};
			const projected = projectWorld(rows.map(sessionRow), mergeWings(storedWings, seen));
			const byId = new Map(rows.map((row) => [row.id, row]));
			world = {
				...projected,
				characters: projected.characters.map((character) => ({
					...character,
					facts: factsOf(byId.get(character.id), readTask)
				}))
			};
			seen = mergeWings(seen, world.wings);
			remember(stored, storedWings, world.wings);
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
						command: parse(row.command) ?? {}
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
		if (++polls % TASK_REREAD_POLLS === 0) lastSeq = -1;
		const next = read();
		readFeed();
		publish({
			connected: socketOpen && next !== void 0,
			headquarters: next?.headquarters ?? current.headquarters,
			characters: next?.characters ?? current.characters,
			avatarLook: chosenAvatar ?? storedAvatar
		});
	};
	const onLine = (line) => {
		const message = parse(line);
		if (message?.type !== "receipt" || message.commandId !== sending?.commandId || message.stage !== "failed") return;
		console.error(`agent-world: the runtime did not store the preference: ${message.reason ?? "no reason given"}`);
		sending = void 0;
		settleAvatar({
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
	const timer = setInterval(poll, POLL_MS).unref();
	poll();
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
		setAvatarLook(look) {
			chosenAvatar = look;
			const stored = new Promise((resolve) => {
				const timer = setTimeout(() => {
					avatarWaiters.delete(done);
					resolve({
						ok: false,
						reason: "The session runtime did not store it yet; it will when it answers."
					});
				}, STORE_TIMEOUT_MS);
				const done = (result) => {
					clearTimeout(timer);
					resolve(result);
				};
				avatarWaiters.add(done);
			});
			lastSeq = -1;
			poll();
			return stored;
		},
		close() {
			closed = true;
			settleAvatar({
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
//#region apps/agent-world/src/electron/main.ts
var appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
var CAPTURE_DELAY_MS = 3e3;
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
function start() {
	const world = openWorldBackend(statePaths());
	const conversations = openConversations(statePaths().socket);
	let window;
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
	world.subscribe((snapshot) => {
		if (window && !window.isDestroyed()) window.webContents.send("world:update", snapshot);
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
			backgroundColor: "#140e18",
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
		if (capture) window.webContents.once("did-finish-load", () => setTimeout(async () => {
			const image = await window?.webContents.capturePage();
			if (image) writeFileSync(capture, image.toPNG());
			app.quit();
		}, CAPTURE_DELAY_MS));
	});
}
//#endregion
export {};

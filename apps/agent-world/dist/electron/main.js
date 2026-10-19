import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWindow, app, ipcMain, net, protocol } from "electron";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { DatabaseSync } from "node:sqlite";
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
					headcount: workers.filter((worker) => worker.place.repository === repository).length
				}))
			};
		}),
		characters,
		wings
	};
}
//#endregion
//#region apps/agent-world/src/backend/world-backend.ts
/** How often new `events` rows are looked for; updates must reach the world within a second. */
var POLL_MS = 200;
var RECONNECT_MS = 1e3;
/** After a failed preference write, wait this long before sending it again. */
var RETRY_MS = 5e3;
/** The `preferences` key Agent World keeps its choices under: `{ wings: { [coordinator id]: repository[] } }`. */
var PREFERENCE_KEY = "agent-world";
var SESSIONS = `
select s.id, s.name, s.cwd, s.reports_to as reportsTo, s.git, s.config,
	(select min(f.started_at) from incarnations f where f.session_id = s.id) as firstStartedAt,
	coalesce(i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost'), 0) as awake
from sessions s
left join incarnations i on i.session_id = s.id and i.generation = s.generation
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
	let retryAt = 0;
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
	/** Send the wings to the runtime when they differ from what it stored, keeping the preference's other keys. */
	const remember = (stored, storedWings, wings) => {
		const next = mergeWings(storedWings, wings);
		const json = JSON.stringify(next);
		if (json === JSON.stringify(storedWings)) {
			sending = void 0;
			return;
		}
		if (!socket || !socketOpen || json === sending?.wings || Date.now() < retryAt) return;
		const commandId = `agent-world-${randomUUID()}`;
		sending = {
			commandId,
			wings: json
		};
		const command = {
			kind: "set_preference",
			key: PREFERENCE_KEY,
			value: {
				...stored,
				wings: next
			}
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
			const sessions = db.prepare(SESSIONS).all().map(sessionRow);
			const stored = storedPreference(db);
			const storedWings = stored.wings && typeof stored.wings === "object" ? stored.wings : {};
			world = projectWorld(sessions, mergeWings(storedWings, seen));
			seen = mergeWings(seen, world.wings);
			remember(stored, storedWings, world.wings);
			return world;
		} catch {
			dropDb();
			return;
		}
	};
	const poll = () => {
		if (closed) return;
		const next = read();
		publish({
			connected: socketOpen && next !== void 0,
			headquarters: next?.headquarters ?? current.headquarters,
			characters: next?.characters ?? current.characters
		});
	};
	const onLine = (line) => {
		const message = parse(line);
		if (message?.type !== "receipt" || message.commandId !== sending?.commandId || message.stage !== "failed") return;
		console.error(`agent-world: the runtime did not store the wings: ${message.reason ?? "no reason given"}`);
		sending = void 0;
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
		close() {
			closed = true;
			clearInterval(timer);
			clearTimeout(reconnect);
			clearTimeout(retry);
			socket?.destroy();
			dropDb();
			listeners.clear();
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
	let window;
	ipcMain.handle("world:snapshot", () => world.snapshot());
	world.subscribe((snapshot) => {
		if (window && !window.isDestroyed()) window.webContents.send("world:update", snapshot);
	});
	app.on("second-instance", () => {
		if (!window) return;
		if (window.isMinimized()) window.restore();
		window.show();
		window.focus();
	});
	app.on("window-all-closed", () => app.quit());
	app.on("will-quit", () => world.close());
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

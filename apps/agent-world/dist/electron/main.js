import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWindow, app, ipcMain, net, protocol } from "electron";
import { homedir } from "node:os";
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
//#region apps/agent-world/src/backend/world-backend.ts
/** How often new `events` rows are looked for; updates must reach the world within a second. */
var POLL_MS = 200;
var RECONNECT_MS = 1e3;
var AWAKE = `
select s.id, s.name, s.cwd
from sessions s
join incarnations i on i.session_id = s.id and i.generation = s.generation
where s.kind = 'root' and i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost')
order by i.started_at, s.id`;
function openWorldBackend(paths) {
	const listeners = /* @__PURE__ */ new Set();
	let current = {
		connected: false,
		characters: []
	};
	let db;
	let socket;
	let socketOpen = false;
	let lastSeq = -1;
	let closed = false;
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
	const read = () => {
		openDb();
		if (!db) return void 0;
		try {
			const { seq } = db.prepare("select coalesce(max(seq), 0) as seq from events").get();
			if (seq === lastSeq) return current.characters;
			lastSeq = seq;
			return db.prepare(AWAKE).all().map((row) => ({
				id: row.id,
				name: row.name || basename(row.cwd)
			}));
		} catch {
			dropDb();
			return;
		}
	};
	const poll = () => {
		if (closed) return;
		const characters = read();
		publish({
			connected: socketOpen && characters !== void 0,
			characters: characters ?? current.characters
		});
	};
	let reconnect;
	const connect = () => {
		if (closed) return;
		const next = createConnection(paths.socket);
		socket = next;
		next.on("connect", () => {
			socketOpen = true;
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

// Agent World's Electron main process: one window over the world UI, wired to the backend through IPC. It reads, and
// acts only when asked (Go to its terminal switches the operator's tmux client); closing the window quits the app and
// changes nothing in tmux or Pi. Built with the preload into
// dist/electron/ (`npm run build:world`), since Electron runs no TypeScript.
//
// AGENT_WORLD_CAPTURE=<file.png> writes a screenshot of the window once the world has drawn, then quits.
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, net, protocol } from "electron";
import { agentDir, statePaths } from "../../../../components/session-state/src/paths.js";
import { appFile } from "../app-files.js";
import { openConversations } from "../backend/conversations.js";
import { openWorldBackend } from "../backend/world-backend.js";

// This file runs as dist/electron/main.js, two levels below the app directory.
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CAPTURE_DELAY_MS = 3000;

app.setName("Agent World");
// Electron's own data stays under Pi's agent directory; the single-instance lock lives there too.
app.setPath("userData", join(agentDir(), "agent-world", "electron-data"));
protocol.registerSchemesAsPrivileged([
	{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (app.requestSingleInstanceLock()) start();
else app.quit(); // a second /world: the first instance focuses its window

function start() {
	const world = openWorldBackend(statePaths());
	const conversations = openConversations(statePaths().socket);
	let window: BrowserWindow | undefined;

	ipcMain.handle("world:snapshot", () => world.snapshot());
	ipcMain.handle("world:feed", () => world.feed());
	ipcMain.handle("world:terminal", (_event, characterId: unknown) =>
		typeof characterId === "string"
			? world.goToTerminal(characterId)
			: { ok: false, reason: "No character was named." },
	);
	ipcMain.handle("world:conversation", (_event, characterId: unknown, before: unknown) =>
		typeof characterId === "string"
			? conversations.page(characterId, typeof before === "string" ? before : undefined)
			: { ok: false, reason: "No character was named." },
	);
	ipcMain.handle("world:mark-seen", (_event, characterId: unknown) =>
		typeof characterId === "string"
			? conversations.markSeen(characterId)
			: { ok: false, reason: "No character was named." },
	);
	ipcMain.handle("world:avatar-look", (_event, look: unknown) =>
		typeof look === "string" ? world.setAvatarLook(look) : { ok: false, reason: "No look was named." },
	);
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

	void app.whenReady().then(() => {
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
				nodeIntegration: false,
			},
		});
		window.on("closed", () => {
			window = undefined;
		});
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		window.webContents.on("will-navigate", (event) => event.preventDefault());
		void window.loadURL("app://world/index.html");

		const capture = process.env.AGENT_WORLD_CAPTURE;
		if (capture)
			window.webContents.once("did-finish-load", () =>
				setTimeout(async () => {
					const image = await window?.webContents.capturePage();
					if (image) writeFileSync(capture, image.toPNG());
					app.quit();
				}, CAPTURE_DELAY_MS),
			);
	});
}

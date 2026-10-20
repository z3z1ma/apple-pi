// Agent World's Electron main process: one window over the world UI, wired to the backend through IPC. It reads, and
// acts only when asked (Go to its terminal switches the operator's tmux client); closing the window quits the app and
// changes nothing in tmux or Pi. Built with the preload into
// dist/electron/ (`npm run build:world`), since Electron runs no TypeScript.
//
// AGENT_WORLD_CAPTURE=<file.png> writes a screenshot of the window once the world has drawn, then quits.
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";
import { agentDir, statePaths } from "../../../../components/session-state/src/paths.js";
import { appFile } from "../app-files.js";
import { openCommands } from "../backend/commands.js";
import { openConversations } from "../backend/conversations.js";
import { instruct } from "../backend/instructions.js";
import { openLifecycle } from "../backend/lifecycle.js";
import { openLink } from "../backend/links.js";
import { openNotepads } from "../backend/notepad.js";
import { listThemes, themeBackdrop } from "../backend/theme-packs.js";
import { leaveOutUnchanged, openWorldBackend } from "../backend/world-backend.js";
import { wireIntegrations } from "./integrations-ipc.js";

// This file runs as dist/electron/main.js, two levels below the app directory.
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** How long the capture waits for a place to draw, and then for its art to settle. */
const CAPTURE_WAIT_MS = 20_000;
const CAPTURE_DELAY_MS = 1500;

app.setName("Agent World");
// Electron's own data stays under Pi's agent directory; the single-instance lock lives there too.
app.setPath("userData", join(agentDir(), "agent-world", "electron-data"));
protocol.registerSchemesAsPrivileged([
	{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (app.requestSingleInstanceLock()) start();
else app.quit(); // a second /world: the first instance focuses its window

/**
 * The capture hook: once a place scene has drawn its painting (or after `CAPTURE_WAIT_MS`), write the window as a
 * PNG, print which place it shows, and quit.
 */
async function captureWhenDrawn(window: BrowserWindow, file: string) {
	const drawn = `(() => { const v = window.agentWorldView; const p = v && v.place(); return p && v.painting() ? p : ""; })()`;
	const until = Date.now() + CAPTURE_WAIT_MS;
	let place = "";
	while (!window.isDestroyed() && Date.now() < until) {
		place = String((await window.webContents.executeJavaScript(drawn).catch(() => "")) ?? "");
		if (place) break;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	await new Promise((resolve) => setTimeout(resolve, CAPTURE_DELAY_MS));
	const image = !window.isDestroyed() ? await window.webContents.capturePage() : undefined;
	if (image) writeFileSync(file, image.toPNG());
	console.log(`agent-world capture: ${place ? `place ${place}` : "no place drew"}`);
	app.quit();
}

function start() {
	const world = openWorldBackend(statePaths());
	const conversations = openConversations(statePaths().socket);
	const commands = openCommands(statePaths().socket);
	let window: BrowserWindow | undefined;
	const toWindow = (channel: string, message: unknown) => {
		if (window && !window.isDestroyed()) window.webContents.send(channel, message);
	};

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
	// Settings: the theme packs, each checked as the window asks, and the one chosen.
	ipcMain.handle("world:themes", () => listThemes(join(appDir, "themes")));
	ipcMain.handle("world:set-theme", (_event, id: unknown) => {
		if (typeof id !== "string") return { ok: false, reason: "No theme was named." };
		if (window && !window.isDestroyed()) window.setBackgroundColor(themeBackdrop(join(appDir, "themes"), id));
		return world.setTheme(id);
	});
	ipcMain.handle("world:instruct", (_event, characterId: unknown, commandId: unknown, instruction: unknown) => {
		if (typeof characterId !== "string" || typeof commandId !== "string" || !commandId)
			return { ok: false, reason: "No character was named." };
		const character = world.snapshot().characters.find((c) => c.id === characterId);
		return instruct(commands, character, commandId, instruction, (stage, reason) =>
			toWindow("world:receipt", { commandId, characterId, stage, ...(reason ? { reason } : {}) }),
		);
	});
	ipcMain.handle("world:watch-replies", (_event, characterIds: unknown) =>
		conversations.watch(Array.isArray(characterIds) ? characterIds.filter((id) => typeof id === "string") : []),
	);
	conversations.onReply((event) => toWindow("world:reply", event));
	// The inn, the rookery, and ending a session.
	const lifecycle = openLifecycle(statePaths(), commands, () => world.snapshot());
	const unnamed = { ok: false, reason: "No character was named." };
	ipcMain.handle("world:wake", (_event, characterId: unknown) =>
		typeof characterId === "string" ? lifecycle.wake(characterId) : unnamed,
	);
	ipcMain.handle("world:end-session", (_event, characterId: unknown, confirmed: unknown) =>
		typeof characterId === "string" ? lifecycle.endSession(characterId, confirmed === true) : unnamed,
	);
	ipcMain.handle("world:send-mail", (_event, characterId: unknown, body: unknown) =>
		typeof characterId === "string" && typeof body === "string" ? lifecycle.sendMail(characterId, body) : unnamed,
	);
	// Recruiting a new agent: a worker at its coordinator's desk, an independent one at the square's recruiter.
	ipcMain.handle("world:recruit", (_event, request: unknown) => {
		const { name, cwd, brief, reportsTo } = (request ?? {}) as Record<string, unknown>;
		if (typeof name !== "string" || typeof cwd !== "string" || typeof brief !== "string")
			return { ok: false, reason: "The recruit needs a name, a directory, and a brief." };
		return lifecycle.recruit({ name, cwd, brief, ...(typeof reportsTo === "string" ? { reportsTo } : {}) });
	});
	ipcMain.handle("world:rename", (_event, characterId: unknown, name: unknown) =>
		typeof characterId === "string" && typeof name === "string" ? lifecycle.rename(characterId, name) : unnamed,
	);
	// The coordinator's notepad in its headquarters: NOTES.md in its directory, named here by the coordinator only.
	const notepads = openNotepads(
		() => world.snapshot(),
		(change) => toWindow("world:notepad", change),
	);
	const noCoordinator = { ok: false, reason: "No coordinator was named." };
	ipcMain.handle("world:open-notepad", (_event, coordinatorId: unknown) =>
		typeof coordinatorId === "string" ? notepads.open(coordinatorId) : noCoordinator,
	);
	ipcMain.handle("world:save-notepad", (_event, coordinatorId: unknown, text: unknown, base: unknown) =>
		typeof coordinatorId === "string" && typeof text === "string" && typeof base === "string"
			? notepads.save(coordinatorId, text, base)
			: noCoordinator,
	);
	ipcMain.handle("world:close-notepad", () => notepads.close());
	// The function places: GitHub, Jira, Confluence, Slack, the outside-write gate, and delegation.
	wireIntegrations({ stateDir: statePaths().dir, snapshot: () => world.snapshot(), commands, toWindow });
	// Links in transcripts open in the system browser, web links only.
	ipcMain.handle("world:open-link", (_event, url: unknown) => openLink(url, (href) => shell.openExternal(href)));
	// Each update leaves out the inn and the mail while they are unchanged: with thousands asleep, sending them on every
	// update was most of the IPC traffic (ticket 31). The renderer's store keeps its own (`web/world-store.ts`).
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
		notepads.close();
		conversations.close();
		commands.close();
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
			// The chosen theme's backdrop, so the window opens in the colour its world will draw.
			backgroundColor: themeBackdrop(join(appDir, "themes"), world.snapshot().theme),
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
		if (capture) window.webContents.once("did-finish-load", () => window && void captureWhenDrawn(window, capture));
	});
}

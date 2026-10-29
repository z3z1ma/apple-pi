// Agent World's Electron main process: one window over the world UI, wired to the backend through IPC. It reads, and
// acts only when asked (Go to its terminal switches the operator's tmux client); closing the window quits the app and
// changes nothing in tmux or Pi. Built with the preload into
// dist/electron/ (`npm run build:world`), since Electron runs no TypeScript.
//
// AGENT_WORLD_CAPTURE=<file.png> writes a screenshot of the window once the world has drawn, then quits.
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { agentDir, statePaths } from "../../../../components/session-state/src/paths.js";
import { appFile } from "../app-files.js";
import { openCommands } from "../backend/commands.js";
import { openConversations } from "../backend/conversations.js";
import { openEmbeddedTerminals } from "../backend/embedded-terminal.js";
import { instruct } from "../backend/instructions.js";
import { openLifecycle } from "../backend/lifecycle.js";
import { openFileLink, openLink } from "../backend/links.js";
import { openNotepads } from "../backend/notepad.js";
import { openOrg } from "../backend/org.js";
import { listThemes, themeBackdrop } from "../backend/theme-packs.js";
import { openWorkplace } from "../backend/workplace.js";
import { openWorkspace } from "../backend/workspace.js";
import { leaveOutUnchanged, openWorldBackend } from "../backend/world-backend.js";
import { isCallInRequest } from "../call-in.js";
import { isOrgMoveRequest, isOrgStartRequest } from "../org.js";
import {
	isWorkspaceDiff,
	isWorkspacePath,
	isWorkspaceResolvePaths,
	isWorkspaceRoot,
	isWorkspaceSave,
	type WorkspaceApi,
} from "../workspace.js";
import { wireIntegrations } from "./integrations-ipc.js";
import { wireTerminals } from "./terminal-ipc.js";

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

function wireWorkspace(workspace: WorkspaceApi) {
	const invalid = { ok: false, reason: "A valid workspace root and relative path are required." };
	ipcMain.handle("workspace:repositories", () => workspace.repositories());
	ipcMain.handle("workspace:files", (_event, request: unknown) =>
		isWorkspaceRoot(request) ? workspace.files(request) : invalid,
	);
	ipcMain.handle("workspace:worktrees", (_event, request: unknown) =>
		isWorkspaceRoot(request) ? workspace.worktrees(request) : invalid,
	);
	ipcMain.handle("workspace:resolve-paths", (_event, request: unknown) =>
		isWorkspaceResolvePaths(request)
			? workspace.resolvePaths({ paths: request.paths, ...(request.cwd !== undefined ? { cwd: request.cwd } : {}) })
			: invalid,
	);
	ipcMain.handle("workspace:tree", (_event, request: unknown) =>
		isWorkspacePath(request) ? workspace.tree(request) : invalid,
	);
	ipcMain.handle("workspace:read-file", (_event, request: unknown) =>
		isWorkspacePath(request) ? workspace.readFile(request) : invalid,
	);
	ipcMain.handle("workspace:save-file", (_event, request: unknown) =>
		isWorkspaceSave(request) ? workspace.saveFile(request) : invalid,
	);
	ipcMain.handle("workspace:git-status", (_event, request: unknown) =>
		isWorkspaceRoot(request) ? workspace.gitStatus(request) : invalid,
	);
	ipcMain.handle("workspace:git-diff", (_event, request: unknown) =>
		isWorkspaceDiff(request) ? workspace.gitDiff(request) : invalid,
	);
}

function start() {
	const world = openWorldBackend(statePaths());
	wireWorkspace(openWorkspace(() => world.snapshot()));
	const conversations = openConversations(statePaths().socket);
	const commands = openCommands(statePaths().socket);
	let window: BrowserWindow | undefined;
	const toWindow = (channel: string, message: unknown) => {
		if (window && !window.isDestroyed()) window.webContents.send(channel, message);
	};
	const terminals = openEmbeddedTerminals();
	wireTerminals(terminals, () => window?.webContents);
	terminals.onEvent((event) => toWindow("terminal:event", event));

	ipcMain.handle("world:snapshot", () => world.snapshot());
	ipcMain.handle("world:feed", () => world.feed());
	ipcMain.handle("world:terminal", (_event, characterId: unknown) =>
		typeof characterId === "string"
			? world.goToTerminal(characterId)
			: { ok: false, reason: "No character was named." },
	);
	ipcMain.handle("world:profile", (_event, characterId: unknown) =>
		typeof characterId === "string" ? world.profile(characterId) : { ok: false, reason: "No character was named." },
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
	const lifecycle = openLifecycle({ ...statePaths(), agentDir: agentDir() }, commands, () => world.snapshot());
	const org = openOrg({ ...statePaths(), agentDir: agentDir() }, commands, () => world.snapshot());
	org.onOrgStart((progress) => toWindow("world:org-progress", progress));
	ipcMain.handle("world:org-move", (_event, request: unknown) =>
		isOrgMoveRequest(request)
			? org.orgMove(request)
			: { ok: false, reason: "A person, manager and observed branch are required." },
	);
	ipcMain.handle("world:org-start", (_event, request: unknown) =>
		isOrgStartRequest(request)
			? org.orgStart(request)
			: {
					id: "",
					people: [],
					complete: false,
					next: "retry",
					note: "A team task, repository and valid positions are required.",
				},
	);
	const unnamed = { ok: false, reason: "No character was named." };
	ipcMain.handle("world:wake", (_event, characterId: unknown) =>
		typeof characterId === "string" ? lifecycle.wake(characterId) : unnamed,
	);
	ipcMain.handle("world:call-in", (_event, request: unknown) =>
		isCallInRequest(request)
			? lifecycle.callIn(request)
			: { ok: false, people: [], reason: "A valid confirmed call-in is required." },
	);
	ipcMain.handle("world:end-session", (_event, characterId: unknown, confirmed: unknown) =>
		typeof characterId === "string" ? lifecycle.endSession(characterId, confirmed === true) : unnamed,
	);
	ipcMain.handle("world:send-mail", (_event, characterId: unknown, body: unknown) =>
		typeof characterId === "string" && typeof body === "string" ? lifecycle.sendMail(characterId, body) : unnamed,
	);
	ipcMain.handle("world:read-thread", (_event, thread: unknown) =>
		typeof thread === "string" ? lifecycle.readThread(thread) : { ok: false, reason: "No thread was named." },
	);
	ipcMain.handle("world:reply-thread", (_event, thread: unknown, body: unknown) =>
		typeof thread === "string" && typeof body === "string"
			? lifecycle.replyThread(thread, body)
			: { ok: false, reason: "A thread and reply are required." },
	);
	const workplace = openWorkplace(statePaths().db, commands, () => world.snapshot());
	ipcMain.handle("world:read-task", (_event, task: unknown) =>
		typeof task === "string" ? workplace.readTask(task) : { ok: false, reason: "No task was named." },
	);
	ipcMain.handle("world:assign-task", (_event, person: unknown, task: unknown) =>
		typeof person === "string" && typeof task === "string"
			? workplace.assignTask(person, task)
			: { ok: false, reason: "A person and task are required." },
	);
	ipcMain.handle("world:workplace-thread", (_event, thread: unknown) =>
		typeof thread === "string" ? workplace.readWorkplaceThread(thread) : { ok: false, reason: "No thread was named." },
	);
	ipcMain.handle("world:channel-membership", (_event, thread: unknown, joined: unknown) =>
		typeof thread === "string" && typeof joined === "boolean"
			? workplace.setChannelMembership(thread, joined)
			: { ok: false, reason: "A channel and whether to join are required." },
	);
	// Recruiting a new agent: a worker at its coordinator's desk, an independent one at the square's recruiter.
	ipcMain.handle("world:recruit", (_event, request: unknown) => {
		const { name, cwd, brief, reportsTo, role, specialization } = (request ?? {}) as Record<string, unknown>;
		if (typeof name !== "string" || typeof cwd !== "string" || (brief !== undefined && typeof brief !== "string"))
			return { ok: false, reason: "The recruit needs a name and directory, with an optional text goal." };
		return lifecycle.recruit({
			name,
			cwd,
			brief,
			...(typeof reportsTo === "string" ? { reportsTo } : {}),
			...(typeof role === "string" ? { role } : {}),
			...(typeof specialization === "string" ? { specialization } : {}),
		});
	});
	ipcMain.handle("world:roles", () => lifecycle.roles());
	ipcMain.handle("world:retire", (_event, characterId: unknown, reason: unknown) =>
		typeof characterId === "string" && typeof reason === "string" ? lifecycle.retire(characterId, reason) : unnamed,
	);
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
	// Links to files open in the operator's default app; one that could run is shown in Finder instead.
	ipcMain.handle("world:open-file", (_event, href: unknown, base: unknown) =>
		openFileLink(
			href,
			base,
			(path) => shell.openPath(path),
			(path) => shell.showItemInFolder(path),
		),
	);
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
		terminals.dispose();
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
			terminals.closeAll();
			window = undefined;
		});
		window.webContents.on("did-frame-navigate", (_event, _url, _code, _status, isMainFrame) => {
			if (isMainFrame) terminals.closeAll();
		});
		window.webContents.on("render-process-gone", () => terminals.closeAll());
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		window.webContents.on("will-prevent-unload", (event) => {
			if (!window || window.isDestroyed()) return;
			const choice = dialog.showMessageBoxSync(window, {
				type: "warning",
				buttons: ["Stay", "Leave"],
				title: "Leave Workplace?",
				message: "Leaving discards unsaved changes and closes running terminals.",
				defaultId: 0,
				cancelId: 0,
				noLink: true,
			});
			// Electron's event cancels the renderer's veto, so preventing it permits unloading.
			if (choice === 1) event.preventDefault();
		});
		window.webContents.on("will-navigate", (event, url) => {
			// Only the app's own view links may navigate.
			if (
				![
					"app://world/index.html",
					"app://world/index.html?",
					"app://world/index.html?world",
					"app://world/index.html?workplace=chat",
					"app://world/index.html?workplace=mail",
					"app://world/index.html?workplace=org",
					"app://world/index.html?workplace=code",
					"app://world/index.html?workplace=issues",
				].includes(url)
			)
				event.preventDefault();
		});
		const capture = process.env.AGENT_WORLD_CAPTURE;
		void window.loadURL(capture ? "app://world/index.html?world" : "app://world/index.html");
		if (capture) window.webContents.once("did-finish-load", () => window && void captureWhenDrawn(window, capture));
	});
}

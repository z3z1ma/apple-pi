import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { livePage, recordWorkplaceFocus } from "../../../../components/browser-pages/src/live-pages.js";
import { agentDir, statePaths } from "../../../../components/session-state/src/paths.js";
import { appFile } from "../app-files.js";
import { lastEditor } from "../backend/code-authors.js";
import { openCommands } from "../backend/commands.js";
import { openCommunications } from "../backend/communications.js";
import { searchConversations } from "../backend/conversation-search.js";
import { openConversations } from "../backend/conversations.js";
import { openDepartures } from "../backend/departures.js";
import { openEmbeddedTerminals } from "../backend/embedded-terminal.js";
import { openGit } from "../backend/git.js";
import { instruct } from "../backend/instructions.js";
import { openLifecycle } from "../backend/lifecycle.js";
import { openFileLink, openLink } from "../backend/links.js";
import { openNotepads } from "../backend/notepad.js";
import { openOrg } from "../backend/org.js";
import { openReviews } from "../backend/reviews.js";
import { listThemes, themeBackdrop } from "../backend/theme-packs.js";
import { openWorkplace } from "../backend/workplace.js";
import { openWorkspace } from "../backend/workspace.js";
import { leaveOutUnchanged, openWorldBackend } from "../backend/world-backend.js";
import { isCallInRequest } from "../call-in.js";
import { isRetirePeopleRequest } from "../departures.js";
import { type GitApi, isGitDiff, isGitLog, isGitRoot, isGitRun, isGitShow } from "../git.js";
import { isOrgMoveRequest, isOrgStartRequest } from "../org.js";
import {
	isWorkspacePath,
	isWorkspaceResolvePaths,
	isWorkspaceRoot,
	isWorkspaceSave,
	type WorkspaceApi,
} from "../workspace.js";
import { OUTSIDE_SOURCES, type OutsideMode, type OutsideSource } from "../world.js";
import { wireCommunications } from "./communications-ipc.js";
import { wireIntegrations } from "./integrations-ipc.js";
import { wireReviews } from "./reviews-ipc.js";
import { wireTerminals } from "./terminal-ipc.js";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CAPTURE_WAIT_MS = 20_000;
const CAPTURE_DELAY_MS = 1500;

app.setName("Agent Workplace");
app.setPath("userData", join(agentDir(), "agent-workplace", "electron-data"));
app.commandLine.appendSwitch("disable-features", "LocalNetworkAccessChecks");
protocol.registerSchemesAsPrivileged([
	{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (app.requestSingleInstanceLock()) start();
else app.quit();
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
	console.log(`agent-workplace capture: ${place ? `place ${place}` : "no place drew"}`);
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
}

function wireGit(git: GitApi) {
	const invalid = { ok: false, reason: "A valid Git request is required." };
	ipcMain.handle("git:overview", (_event, request: unknown) =>
		isGitRoot(request) ? git.overview({ root: request.root }) : invalid,
	);
	ipcMain.handle("git:log", (_event, request: unknown) =>
		isGitLog(request) ? git.log({ root: request.root, skip: request.skip, limit: request.limit }) : invalid,
	);
	ipcMain.handle("git:show", (_event, request: unknown) =>
		isGitShow(request) ? git.show({ root: request.root, sha: request.sha }) : invalid,
	);
	ipcMain.handle("git:diff", (_event, request: unknown) => (isGitDiff(request) ? git.diff(request) : invalid));
	ipcMain.handle("git:run", (_event, request: unknown) =>
		isGitRun(request) ? git.run({ root: request.root, action: request.action }) : invalid,
	);
}

function start() {
	const world = openWorldBackend(statePaths());
	wireWorkspace(openWorkspace(() => world.snapshot()));
	wireGit(openGit());
	const conversations = openConversations(statePaths().socket);
	const commands = openCommands(statePaths().socket);
	wireCommunications(openCommunications(statePaths().db, commands));
	const reviews = openReviews(statePaths().db, commands);
	wireReviews(reviews.api);
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
	ipcMain.handle("world:conversation", (_event, characterId: unknown, before: unknown, textOnly: unknown) =>
		typeof characterId === "string"
			? conversations.page(characterId, typeof before === "string" ? before : undefined, textOnly === true)
			: { ok: false, reason: "No character was named." },
	);
	ipcMain.handle("world:search-conversations", (_event, query: unknown) =>
		typeof query === "string"
			? searchConversations(statePaths().db, query, 30)
			: { ok: false, reason: "No words to search for." },
	);
	ipcMain.handle("world:mark-seen", (_event, characterId: unknown) =>
		typeof characterId === "string"
			? conversations.markSeen(characterId)
			: { ok: false, reason: "No character was named." },
	);
	ipcMain.handle("world:avatar-look", (_event, look: unknown) =>
		typeof look === "string" ? world.setAvatarLook(look) : { ok: false, reason: "No look was named." },
	);
	ipcMain.handle("world:themes", () => listThemes(join(appDir, "themes")));
	ipcMain.handle("world:set-theme", (_event, id: unknown) => {
		if (typeof id !== "string") return { ok: false, reason: "No theme was named." };
		if (window && !window.isDestroyed()) window.setBackgroundColor(themeBackdrop(join(appDir, "themes"), id));
		return world.setTheme(id);
	});
	ipcMain.handle("world:set-desk", (_event, desk: unknown) => {
		const { thread, person } = (desk ?? {}) as { thread?: unknown; person?: unknown };
		if (typeof thread !== "string" || typeof person !== "string")
			return { ok: false, reason: "A desk needs a channel and a person." };
		return world.setDesk({ thread, person });
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
	const lifecycle = openLifecycle({ ...statePaths(), agentDir: agentDir() }, commands, () => world.snapshot());
	const org = openOrg({ ...statePaths(), agentDir: agentDir() }, commands, () => world.snapshot());
	org.onOrgStart((progress) => toWindow("world:org-progress", progress));
	const departures = openDepartures(statePaths().db, commands);
	departures.onRetirePeople((progress) => toWindow("world:departures", progress));
	ipcMain.handle("world:retire-people", (_event, request: unknown) => {
		if (!isRetirePeopleRequest(request)) throw new Error("A confirmed selection and reason are required.");
		return departures.retirePeople(request);
	});
	ipcMain.handle("world:organization-lifetime", (_event, root: unknown) => {
		if (typeof root !== "string" || !root) throw new Error("An organization root is required.");
		return org.organizationLifetime(root);
	});
	ipcMain.handle("world:incorporate-organization", (_event, root: unknown) =>
		typeof root === "string" && root
			? org.incorporateOrganization(root)
			: { ok: false, reason: "An organization root is required." },
	);
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
	ipcMain.handle("world:end-session", (_event, characterId: unknown, confirmed: unknown, dissolve: unknown) =>
		typeof characterId === "string"
			? lifecycle.endSession(characterId, confirmed === true, dissolve === true)
			: unnamed,
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
	ipcMain.handle("world:unassign-task", (_event, person: unknown, task: unknown) =>
		typeof person === "string" && typeof task === "string"
			? workplace.unassignTask(person, task)
			: { ok: false, reason: "A person and task are required." },
	);
	ipcMain.handle("world:read-outside", (_event, request: unknown) => {
		const value = (request ?? {}) as { source?: unknown; untriaged?: unknown; limit?: unknown };
		const source = OUTSIDE_SOURCES.includes(value.source as OutsideSource)
			? (value.source as OutsideSource)
			: undefined;
		return Number.isSafeInteger(value.limit) && (value.limit as number) > 0
			? workplace.readOutside({ source, untriaged: value.untriaged === true, limit: value.limit as number })
			: { ok: false, reason: "A page size is required." };
	});
	ipcMain.handle("world:outside-modes", (_event, modes: unknown) => {
		const chosen: Partial<Record<OutsideSource, OutsideMode>> = {};
		for (const source of OUTSIDE_SOURCES) {
			const mode = (modes as Record<string, unknown> | null)?.[source];
			if (["all", "direct", "list", "off"].includes(mode as string)) chosen[source] = mode as OutsideMode;
		}
		return Object.keys(chosen).length
			? workplace.setOutsideModes(chosen)
			: { ok: false, reason: "Choose a mode for a source." };
	});
	ipcMain.handle("world:list-canvases", (_event, request: unknown) => {
		const value = (request ?? {}) as { words?: unknown; limit?: unknown };
		return Number.isSafeInteger(value.limit) && (value.limit as number) > 0
			? workplace.listCanvases({
					limit: value.limit as number,
					...(typeof value.words === "string" && value.words.trim() ? { words: value.words } : {}),
				})
			: { ok: false, reason: "A page size is required." };
	});
	ipcMain.handle("world:read-canvas", (_event, id: unknown) =>
		typeof id === "string" ? workplace.readCanvas(id) : { ok: false, reason: "No canvas was named." },
	);
	ipcMain.handle("world:write-canvas", (_event, request: unknown) => {
		const value = (request ?? {}) as Record<string, unknown>;
		const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : undefined);
		if (typeof value.remove === "string") return workplace.writeCanvas({ remove: value.remove });
		const create = value.create as { title?: unknown; body?: unknown } | undefined;
		if (create && typeof create.title === "string")
			return workplace.writeCanvas({
				create: { title: create.title, ...(typeof create.body === "string" ? { body: create.body } : {}) },
			});
		if (typeof value.update === "string" && Number.isSafeInteger(value.base))
			return workplace.writeCanvas({
				update: value.update,
				base: value.base as number,
				...(text("title") !== undefined ? { title: text("title") } : {}),
				...(text("body") !== undefined ? { body: text("body") } : {}),
				...(typeof value.pinned === "boolean" ? { pinned: value.pinned } : {}),
			});
		return { ok: false, reason: "Create, update against a version, or remove a canvas." };
	});
	ipcMain.handle("world:read-notes", (_event, request: unknown) => {
		const value = (request ?? {}) as { words?: unknown; limit?: unknown };
		return Number.isSafeInteger(value.limit) && (value.limit as number) > 0
			? workplace.readNotes({
					limit: value.limit as number,
					...(typeof value.words === "string" && value.words.trim() ? { words: value.words } : {}),
				})
			: { ok: false, reason: "A page size is required." };
	});
	ipcMain.handle("world:outside-rule", (_event, request: unknown) => {
		const value = (request ?? {}) as Record<string, unknown>;
		if (typeof value.remove === "string") return workplace.setOutsideRule({ remove: value.remove });
		const raw = (value.match ?? {}) as Record<string, unknown>;
		const match: Record<string, string> = {};
		for (const key of ["source", "kind", "place", "actor", "words"])
			if (typeof raw[key] === "string" && raw[key]) match[key] = raw[key] as string;
		if (!["hide", "quiet", "triage", "route"].includes(value.effect as string) || typeof value.note !== "string")
			return { ok: false, reason: "A rule needs an effect and a note." };
		return workplace.setOutsideRule({
			match,
			effect: value.effect as "hide",
			note: value.note,
			...(typeof value.person === "string" ? { person: value.person } : {}),
		});
	});
	ipcMain.handle("world:close-task", (_event, task: unknown, status: unknown) =>
		typeof task === "string" && (status === "done" || status === "cancelled")
			? workplace.closeTask(task, status)
			: { ok: false, reason: "A task and done or cancelled are required." },
	);
	ipcMain.handle("world:workplace-thread", (_event, thread: unknown) =>
		typeof thread === "string" ? workplace.readWorkplaceThread(thread) : { ok: false, reason: "No thread was named." },
	);
	ipcMain.handle("world:channel-membership", (_event, thread: unknown, joined: unknown) =>
		typeof thread === "string" && typeof joined === "boolean"
			? workplace.setChannelMembership(thread, joined)
			: { ok: false, reason: "A channel and whether to join are required." },
	);
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
	ipcMain.handle("world:retire", (_event, characterId: unknown, reason: unknown, handoff: unknown) =>
		typeof characterId === "string" &&
		typeof reason === "string" &&
		(handoff === undefined || typeof handoff === "boolean")
			? lifecycle.retire(characterId, reason, handoff)
			: unnamed,
	);
	ipcMain.handle("world:rename", (_event, characterId: unknown, name: unknown) =>
		typeof characterId === "string" && typeof name === "string" ? lifecycle.rename(characterId, name) : unnamed,
	);
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
	wireIntegrations({ stateDir: statePaths().dir, snapshot: () => world.snapshot(), commands, toWindow });
	ipcMain.handle("world:open-link", (_event, url: unknown) => openLink(url, (href) => shell.openExternal(href)));
	ipcMain.handle("world:code-author", (_event, path: unknown) =>
		typeof path === "string" ? lastEditor(statePaths().db, path) : null,
	);
	ipcMain.handle("world:browser-page", (_event, characterId: unknown, callId: unknown) =>
		typeof characterId === "string" && typeof callId === "string"
			? (livePage(characterId, callId, agentDir()) ?? null)
			: null,
	);
	ipcMain.handle("world:open-file", (_event, href: unknown, base: unknown) =>
		openFileLink(
			href,
			base,
			(path) => shell.openPath(path),
			(path) => shell.showItemInFolder(path),
		),
	);
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
		recordWorkplaceFocus(false, agentDir());
		reviews.close();
		departures.close();
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
			title: "Agent Workplace",
			backgroundColor: themeBackdrop(join(appDir, "themes"), world.snapshot().theme),
			webPreferences: {
				preload: join(appDir, "dist", "electron", "preload.cjs"),
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
			},
		});
		window.on("closed", () => {
			recordWorkplaceFocus(false, agentDir());
			terminals.closeAll();
			window = undefined;
		});
		window.on("focus", () => recordWorkplaceFocus(true, agentDir()));
		window.on("blur", () => recordWorkplaceFocus(false, agentDir()));
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
			if (choice === 1) event.preventDefault();
		});
		window.webContents.on("will-navigate", (event, url) => {
			if (
				![
					"app://world/index.html",
					"app://world/index.html?",
					"app://world/index.html?world",
					"app://world/index.html?workplace=chat",
					"app://world/index.html?workplace=mail",
					"app://world/index.html?workplace=org",
					"app://world/index.html?workplace=code",
					"app://world/index.html?workplace=git",
					"app://world/index.html?workplace=reviews",
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

// The only way the world UI reaches the backend: a narrow typed API on `window.agentWorld`. Sandboxed preloads run
// as CommonJS with only a few Electron modules, so this is built to dist/electron/preload.cjs.
import { contextBridge, ipcRenderer } from "electron";
import type {
	AgentWorldApi,
	CommandResult,
	ConversationPage,
	FeedLine,
	TerminalResult,
	WorldSnapshot,
} from "../world.js";

const api: AgentWorldApi = {
	snapshot: () => ipcRenderer.invoke("world:snapshot") as Promise<WorldSnapshot>,
	onUpdate(listener) {
		const forward = (_event: unknown, snapshot: WorldSnapshot) => listener(snapshot);
		ipcRenderer.on("world:update", forward);
		return () => ipcRenderer.removeListener("world:update", forward);
	},
	feed: () => ipcRenderer.invoke("world:feed") as Promise<FeedLine[]>,
	onFeed(listener) {
		const forward = (_event: unknown, lines: FeedLine[]) => listener(lines);
		ipcRenderer.on("world:feed", forward);
		return () => ipcRenderer.removeListener("world:feed", forward);
	},
	goToTerminal: (characterId) => ipcRenderer.invoke("world:terminal", characterId) as Promise<TerminalResult>,
	conversation: (characterId, before) =>
		ipcRenderer.invoke("world:conversation", characterId, before) as Promise<ConversationPage>,
	markSeen: (characterId) => ipcRenderer.invoke("world:mark-seen", characterId) as Promise<CommandResult>,
	setAvatarLook: (look) => ipcRenderer.invoke("world:avatar-look", look) as Promise<CommandResult>,
};

contextBridge.exposeInMainWorld("agentWorld", api);

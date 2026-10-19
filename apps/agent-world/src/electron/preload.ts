// The only way the world UI reaches the backend: a narrow typed API on `window.agentWorld`. Sandboxed preloads run
// as CommonJS with only a few Electron modules, so this is built to dist/electron/preload.cjs.
import { contextBridge, ipcRenderer } from "electron";
import type { AgentWorldApi, WorldSnapshot } from "../world.js";

const api: AgentWorldApi = {
	snapshot: () => ipcRenderer.invoke("world:snapshot") as Promise<WorldSnapshot>,
	onUpdate(listener) {
		const forward = (_event: unknown, snapshot: WorldSnapshot) => listener(snapshot);
		ipcRenderer.on("world:update", forward);
		return () => ipcRenderer.removeListener("world:update", forward);
	},
};

contextBridge.exposeInMainWorld("agentWorld", api);

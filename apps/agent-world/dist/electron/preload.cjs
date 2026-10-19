let electron = require("electron");
//#region apps/agent-world/src/electron/preload.ts
electron.contextBridge.exposeInMainWorld("agentWorld", {
	snapshot: () => electron.ipcRenderer.invoke("world:snapshot"),
	onUpdate(listener) {
		const forward = (_event, snapshot) => listener(snapshot);
		electron.ipcRenderer.on("world:update", forward);
		return () => electron.ipcRenderer.removeListener("world:update", forward);
	},
	feed: () => electron.ipcRenderer.invoke("world:feed"),
	onFeed(listener) {
		const forward = (_event, lines) => listener(lines);
		electron.ipcRenderer.on("world:feed", forward);
		return () => electron.ipcRenderer.removeListener("world:feed", forward);
	},
	goToTerminal: (characterId) => electron.ipcRenderer.invoke("world:terminal", characterId)
});
//#endregion

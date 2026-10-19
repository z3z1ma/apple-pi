let electron = require("electron");
//#region apps/agent-world/src/electron/preload.ts
electron.contextBridge.exposeInMainWorld("agentWorld", {
	snapshot: () => electron.ipcRenderer.invoke("world:snapshot"),
	onUpdate(listener) {
		const forward = (_event, snapshot) => listener(snapshot);
		electron.ipcRenderer.on("world:update", forward);
		return () => electron.ipcRenderer.removeListener("world:update", forward);
	}
});
//#endregion

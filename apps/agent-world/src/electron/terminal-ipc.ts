import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { isTerminalClose, isTerminalCreate, isTerminalResize, isTerminalWrite, type TerminalApi } from "../terminal.js";

export function wireTerminals(terminals: TerminalApi, owner: () => WebContents | undefined) {
	const allowed = (event: IpcMainInvokeEvent) => {
		const contents = owner();
		return contents !== undefined && event.sender === contents && event.senderFrame === contents.mainFrame;
	};
	const invalid = { ok: false, reason: "A valid terminal request from the application window is required." };
	ipcMain.handle("terminal:create", (event, request: unknown) =>
		allowed(event) && isTerminalCreate(request)
			? terminals.create({ id: request.id, cwd: request.cwd, cols: request.cols, rows: request.rows })
			: invalid,
	);
	ipcMain.handle("terminal:write", (event, request: unknown) =>
		allowed(event) && isTerminalWrite(request) ? terminals.write({ id: request.id, data: request.data }) : invalid,
	);
	ipcMain.handle("terminal:resize", (event, request: unknown) =>
		allowed(event) && isTerminalResize(request)
			? terminals.resize({ id: request.id, cols: request.cols, rows: request.rows })
			: invalid,
	);
	ipcMain.handle("terminal:close", (event, request: unknown) =>
		allowed(event) && isTerminalClose(request) ? terminals.close({ id: request.id }) : invalid,
	);
}

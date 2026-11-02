import { ipcMain } from "electron";
import type { CommunicationsApi } from "../communications.js";

export function wireCommunications(api: CommunicationsApi): void {
	const methods: (keyof CommunicationsApi)[] = [
		"sendMail",
		"findChannels",
		"createChannel",
		"readThread",
		"searchMessages",
		"post",
		"join",
		"leave",
		"invite",
		"removeInvitations",
		"pin",
		"archive",
		"reopen",
		"status",
	];
	for (const method of methods) {
		ipcMain.handle(`communications:${method}`, (_event, request: unknown) => {
			if (!request || typeof request !== "object" || Array.isArray(request))
				throw new Error("A communication request is required.");
			// Each adapter extracts its own operation fields; the renderer never supplies a runtime command.
			return api[method](request as never);
		});
	}
}

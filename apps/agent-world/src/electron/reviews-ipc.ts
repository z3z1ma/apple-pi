import { ipcMain, shell } from "electron";
import type { ReviewsApi } from "../reviews.js";

export function wireReviews(api: ReviewsApi): void {
	const methods: (keyof ReviewsApi)[] = [
		"queue",
		"analytics",
		"read",
		"source",
		"freshness",
		"preview",
		"enqueue",
		"manage",
		"signOff",
	];
	for (const method of methods) {
		ipcMain.handle(`reviews:${method}`, async (_event, request: unknown) => {
			if (!request || typeof request !== "object" || Array.isArray(request))
				throw new Error("A review request is required");
			if (method === "signOff") {
				const page = await api.signOff(request as Parameters<ReviewsApi["signOff"]>[0]);
				await shell.openExternal(page.url);
				return page;
			}
			return api[method](request as never);
		});
	}
}

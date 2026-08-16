import { describe, expect, it, vi } from "vitest";
import {
	registerInvisibleContinue,
	triggerInvisibleContinue,
	VCC_RESUME_CUSTOM_TYPE,
} from "../src/core/invisible-continue.js";

describe("VCC native continuation transport", () => {
	it("queues a hidden native follow-up instead of calling Agent.prompt directly", () => {
		const sendMessage = vi.fn();
		triggerInvisibleContinue({ sendMessage } as any);

		expect(sendMessage).toHaveBeenCalledWith(
			{
				customType: VCC_RESUME_CUSTOM_TYPE,
				content: [],
				display: false,
				details: undefined,
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	});

	it("removes its hidden marker from provider context", () => {
		let contextHandler: ((event: any) => unknown) | undefined;
		const pi = {
			on(event: string, handler: (event: any) => unknown) {
				if (event === "context") contextHandler = handler;
			},
		};
		registerInvisibleContinue(pi as any);

		const user = { role: "user", content: [{ type: "text", text: "keep" }] };
		const marker = { role: "custom", customType: VCC_RESUME_CUSTOM_TYPE, content: [] };
		expect(contextHandler?.({ messages: [user, marker] })).toEqual({ messages: [user] });
	});
});

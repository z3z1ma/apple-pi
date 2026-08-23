import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { registerOverflowGuard } from "../src/hooks/overflow-guard.js";

type Handler = (event: any, ctx: ExtensionContext) => unknown;

function captureExtension() {
	const handlers = new Map<string, Handler[]>();
	const providerRegistrations: Array<{ name: string; config: ProviderConfig }> = [];
	const pi = {
		on(event: string, handler: Handler) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
		registerProvider(name: string, config: ProviderConfig) {
			providerRegistrations.push({ name, config });
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers, providerRegistrations };
}

describe("proactive overflow guard", () => {
	it("intercepts the next provider request after an oversized tool turn without calling upstream", async () => {
		const faux = registerFauxProvider({
			provider: "guard-test",
			models: [{ id: "guard-model", contextWindow: 272_000 }],
		});
		faux.setResponses([fauxAssistantMessage("this request must not be sent")]);

		try {
			const { pi, handlers, providerRegistrations } = captureExtension();
			const runtime = {
				ensureConfig() {},
				config: {
					compactAfterTokens: 10,
					compactAfterTokensMode: "calibrated",
					compactAfterTokensRatio: 0.68,
					passive: false,
				},
			};
			registerOverflowGuard(pi, runtime as never);

			const model = faux.getModel();
			let contextTokens = 92_630;
			const ctx = {
				cwd: "/tmp/project",
				model,
				isProjectTrusted: () => false,
				getContextUsage: () => ({ tokens: contextTokens, contextWindow: model.contextWindow, percent: 34 }),
				ui: { notify() {} },
			} as unknown as ExtensionContext;
			const turnEnd = handlers.get("turn_end")?.[0];
			await turnEnd?.(
				{
					type: "turn_end",
					message: fauxAssistantMessage("tool call"),
					toolResults: [{ toolCallId: "tool-1" }],
				},
				ctx,
			);
			expect(providerRegistrations).toHaveLength(0);

			contextTokens = 260_000;
			await turnEnd?.(
				{
					type: "turn_end",
					message: fauxAssistantMessage("tool call"),
					toolResults: [{ toolCallId: "tool-1" }],
				},
				ctx,
			);

			const streamSimple = providerRegistrations[0]?.config.streamSimple;
			expect(streamSimple).toBeDefined();
			const result = await streamSimple!(
				model,
				{
					systemPrompt: "",
					messages: [
						{
							role: "toolResult",
							toolCallId: "tool-1",
							toolName: "read",
							content: [{ type: "text", text: "large result" }],
							isError: false,
							timestamp: Date.now(),
						},
					],
					tools: [],
				},
				{},
			);

			const overflow = await result.result();
			expect(overflow).toMatchObject({ stopReason: "stop", content: [] });
			expect(overflow.errorMessage).toBeUndefined();
			expect(faux.state.callCount).toBe(0);
		} finally {
			faux.unregister();
		}
	});
});

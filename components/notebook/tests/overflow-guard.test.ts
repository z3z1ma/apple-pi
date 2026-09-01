import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { registerOverflowGuard } from "../src/hooks/overflow-guard.js";

type Handler = (event: any, ctx: ExtensionContext) => unknown;

function captureExtension() {
	const handlers = new Map<string, Handler[]>();
	const messages: Array<{ message: unknown; options: unknown }> = [];
	const pi = {
		on(event: string, handler: Handler) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
		sendMessage(message: unknown, options: unknown) {
			messages.push({ message, options });
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers, messages };
}

function runtime(passive = false) {
	return {
		ensureConfig() {},
		config: {
			compactAfterTokens: 10,
			compactAfterTokensMode: "calibrated",
			compactAfterTokensRatio: 0.68,
			passive,
		},
	};
}

function testContext(cwd: string, tokens: number | null, branch: unknown[] = []) {
	return {
		cwd,
		model: { id: "guard-model", provider: "guard-test", contextWindow: 1_000 },
		isProjectTrusted: () => true,
		getContextUsage: () => ({ tokens, contextWindow: 1_000, percent: tokens === null ? null : tokens / 10 }),
		sessionManager: { getBranch: () => branch },
	} as unknown as ExtensionContext;
}

function oversizedTurn() {
	return {
		type: "turn_end",
		toolResults: [{ toolCallId: "tool-1", content: [{ type: "text", text: "x".repeat(1_000) }] }],
	};
}

function withSettings(run: (cwd: string) => Promise<void> | void) {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-overflow-guard-"));
	mkdirSync(join(cwd, ".pi"));
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({ compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 10 } }),
	);
	return Promise.resolve(run(cwd)).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

describe("oversized-result compaction cut point", () => {
	it("queues a hidden cut point after an over-budget tool turn", () =>
		withSettings(async (cwd) => {
			const { handlers, messages, pi } = captureExtension();
			registerOverflowGuard(pi, runtime() as never);

			await handlers.get("turn_end")?.[0]?.(oversizedTurn(), testContext(cwd, 950));

			expect(messages).toEqual([
				{
					message: { customType: "apple-pi.compaction-cut-point", content: [], display: false },
					options: { deliverAs: "steer", triggerTurn: false },
				},
			]);
		}));

	it("uses a conservative branch estimate when Pi reports unknown post-compaction usage", () =>
		withSettings(async (cwd) => {
			const { handlers, messages, pi } = captureExtension();
			registerOverflowGuard(pi, runtime() as never);
			const branch = [{ type: "custom", data: "x".repeat(5_000) }];

			await handlers.get("turn_end")?.[0]?.(oversizedTurn(), testContext(cwd, null, branch));

			expect(messages).toHaveLength(1);
		}));

	it("filters the durable marker from provider context after reload", async () => {
		const { handlers, pi } = captureExtension();
		registerOverflowGuard(pi, runtime() as never);
		const context = handlers.get("context")?.[0];
		const ordinary = { role: "user", content: "continue" };
		const marker = { role: "custom", customType: "apple-pi.compaction-cut-point", content: [] };

		expect(context?.({ messages: [ordinary, marker] }, {} as ExtensionContext)).toEqual({ messages: [ordinary] });
	});
});

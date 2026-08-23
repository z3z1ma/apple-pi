import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { type FastModeStorage, registerCodexFast } from "../src/index.js";

type Handler = (event: any, ctx: ExtensionContext) => any;

function harness(storage: FastModeStorage) {
	const handlers = new Map<string, Handler>();
	let command: ((args: string, ctx: ExtensionContext) => Promise<void>) | undefined;
	const pi = {
		on(name: string, handler: Handler) {
			handlers.set(name, handler);
		},
		registerCommand(name: string, options: { handler: typeof command }) {
			if (name === "fast") command = options.handler;
		},
	};
	registerCodexFast(pi as unknown as ExtensionAPI, storage);
	return {
		handler(name: string): Handler {
			const handler = handlers.get(name);
			if (!handler) throw new Error(`Missing ${name} handler`);
			return handler;
		},
		command(): NonNullable<typeof command> {
			if (!command) throw new Error("Missing /fast command");
			return command;
		},
	};
}

function context(provider = "openai-codex") {
	const setStatus = vi.fn();
	const notify = vi.fn();
	const ctx = {
		model: { provider },
		ui: {
			setStatus,
			notify,
			theme: {
				fg: (_role: string, text: string) => text,
				strikethrough: (text: string) => `~${text}~`,
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, setStatus, notify };
}

describe("codex fast mode", () => {
	it("applies priority service tier to the next provider request after a mid-turn toggle", async () => {
		let finishSave: (() => void) | undefined;
		const storage: FastModeStorage = {
			load: async () => false,
			save: () => new Promise<void>((resolve) => (finishSave = resolve)),
		};
		const extension = harness(storage);
		const { ctx } = context();
		await extension.handler("session_start")({}, ctx);

		const toggle = extension.command()("", ctx);
		const request = extension.handler("before_provider_request")({ payload: { model: "gpt-5.4" } }, ctx);

		await expect(request).resolves.toEqual({ model: "gpt-5.4", service_tier: "priority" });
		finishSave?.();
		await toggle;
	});

	it("refreshes shared state before continuations in already-running agents", async () => {
		const load = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
		const storage: FastModeStorage = { load, save: async () => undefined };
		const extension = harness(storage);
		const { ctx } = context();
		await extension.handler("session_start")({}, ctx);

		await expect(extension.handler("before_provider_request")({ payload: { model: "gpt-5.4" } }, ctx)).resolves.toEqual(
			{
				model: "gpt-5.4",
				service_tier: "priority",
			},
		);
	});

	it("does not alter requests for other providers", async () => {
		const storage: FastModeStorage = { load: async () => true, save: async () => undefined };
		const extension = harness(storage);
		const { ctx } = context("anthropic");
		await extension.handler("session_start")({}, ctx);

		await expect(
			extension.handler("before_provider_request")({ payload: { model: "claude" } }, ctx),
		).resolves.toBeUndefined();
	});

	it("rolls back the in-memory toggle when persistence fails", async () => {
		const storage: FastModeStorage = {
			load: async () => false,
			save: async () => {
				throw new Error("disk full");
			},
		};
		const extension = harness(storage);
		const { ctx, notify } = context();
		await extension.handler("session_start")({}, ctx);
		await extension.command()("", ctx);

		await expect(extension.handler("before_provider_request")({ payload: {} }, ctx)).resolves.toBeUndefined();
		expect(notify).toHaveBeenCalledWith("Failed to save Fast mode state: disk full", "error");
	});
});

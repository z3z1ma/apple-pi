import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STATUS_ID = "fast-mode";
const CODEX_PROVIDER = "openai-codex";

interface FastModeState {
	enabled: boolean;
}

export interface FastModeStorage {
	load(): Promise<boolean>;
	save(enabled: boolean): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFastModeState(value: unknown): value is FastModeState {
	return isRecord(value) && typeof value.enabled === "boolean";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function configPath(): string {
	return join(getAgentDir(), "codex-fast.json");
}

export const globalFastModeStorage: FastModeStorage = {
	async load(): Promise<boolean> {
		try {
			const state: unknown = JSON.parse(await readFile(configPath(), "utf8"));
			if (!isFastModeState(state)) throw new Error("expected an object with a boolean 'enabled' field");
			return state.enabled;
		} catch (error) {
			if (isRecord(error) && error.code === "ENOENT") return false;
			throw error;
		}
	},
	async save(enabled: boolean): Promise<void> {
		const path = configPath();
		const tempPath = `${path}.${process.pid}.tmp`;
		await mkdir(getAgentDir(), { recursive: true });
		try {
			await writeFile(tempPath, `${JSON.stringify({ enabled }, null, 2)}\n`, {
				encoding: "utf8",
				mode: 0o600,
			});
			await rename(tempPath, path);
		} catch (error) {
			await unlink(tempPath).catch(() => undefined);
			throw error;
		}
	},
};

export function registerCodexFast(pi: ExtensionAPI, storage: FastModeStorage = globalFastModeStorage): void {
	let enabled = false;
	let pendingSave: Promise<void> | undefined;

	function isCodexActive(ctx: ExtensionContext): boolean {
		return ctx.model?.provider === CODEX_PROVIDER;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!enabled) {
			ctx.ui.setStatus(STATUS_ID, undefined);
			return;
		}

		const text = isCodexActive(ctx)
			? ctx.ui.theme.fg("accent", "fast")
			: ctx.ui.theme.fg("dim", ctx.ui.theme.strikethrough("fast"));
		ctx.ui.setStatus(STATUS_ID, text);
	}

	function statusMessage(ctx: ExtensionContext): string {
		if (!enabled) return "Fast mode is off.";
		if (isCodexActive(ctx)) return "Fast mode is on for OpenAI Codex (service_tier: priority).";
		return "Fast mode is on but inactive; select an openai-codex model to use it.";
	}

	async function setEnabled(nextEnabled: boolean, ctx: ExtensionContext): Promise<void> {
		const previousEnabled = enabled;
		enabled = nextEnabled;
		updateStatus(ctx);
		const save = storage.save(nextEnabled);
		pendingSave = save;
		try {
			await save;
		} catch (error) {
			enabled = previousEnabled;
			updateStatus(ctx);
			ctx.ui.notify(`Failed to save Fast mode state: ${errorMessage(error)}`, "error");
			return;
		} finally {
			if (pendingSave === save) pendingSave = undefined;
		}
		ctx.ui.notify(statusMessage(ctx), enabled && !isCodexActive(ctx) ? "warning" : "info");
	}

	pi.registerCommand("fast", {
		description: "Toggle OpenAI Codex Fast mode (priority service tier)",
		handler: async (args, ctx) => {
			if (args.trim() !== "") {
				ctx.ui.notify("Usage: /fast", "error");
				return;
			}
			// Command handlers can run while the agent is streaming. Serialize rapid
			// toggles, but publish the first transition to memory immediately.
			if (pendingSave) await pendingSave.catch(() => undefined);
			await setEnabled(!enabled, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			enabled = await storage.load();
		} catch (error) {
			enabled = false;
			ctx.ui.notify(`Failed to load Fast mode state; defaulting to off: ${errorMessage(error)}`, "warning");
		}
		updateStatus(ctx);
	});

	pi.on("model_select", (_event, ctx) => updateStatus(ctx));

	pi.on("before_provider_request", async (event, ctx) => {
		// Every root, child, and exec worker refreshes the shared setting before
		// each request. A mid-turn toggle therefore affects its next continuation,
		// including agents that were already running when the setting changed.
		if (!pendingSave) {
			try {
				const stored = await storage.load();
				if (stored !== enabled) {
					enabled = stored;
					updateStatus(ctx);
				}
			} catch {
				// Keep the last known state when the shared file is temporarily unreadable.
			}
		}
		if (!enabled || !isCodexActive(ctx) || !isRecord(event.payload)) return;
		return { ...event.payload, service_tier: "priority" };
	});
}

export default function installCodexFast(pi: ExtensionAPI): void {
	registerCodexFast(pi);
}

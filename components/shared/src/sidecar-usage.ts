import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const SIDECAR_USAGE_MAX_BYTES = 10 * 1024 * 1024;
export const SIDECAR_USAGE_DIR_RELATIVE_PATH = "sidecar-usage";
export const SIDECAR_USAGE_UNSCOPED_FILE = "unscoped.ndjson";

export const SIDECAR_USAGE_RECORD_KEYS = [
	"ts",
	"sessionId",
	"agent",
	"trigger",
	"status",
	"provider",
	"model",
	"input",
	"cacheRead",
	"cacheWrite",
	"output",
	"cost",
	"durationMs",
	"threshold",
] as const;

export type SidecarAgent = "sentinel" | "advisor" | "observer" | "reflector" | "dropper" | "curator";

export type SidecarUsageRecord = {
	ts: string;
	sessionId?: string;
	agent: SidecarAgent;
	trigger: string;
	status: string;
	provider: string;
	model: string;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	cost: number;
	durationMs: number;
	threshold?: number;
};

export type SidecarUsageInput = {
	agent: SidecarAgent;
	trigger: string;
	status: string;
	provider?: string;
	model?: string;
	input?: number;
	cacheRead?: number;
	cacheWrite?: number;
	output?: number;
	cost?: number;
	durationMs?: number;
	threshold?: number;
	sessionId?: string;
};

export type SidecarUsageContext = {
	sessionId?: string;
	threshold?: number;
	trigger?: string;
};

const storage = new AsyncLocalStorage<SidecarUsageContext>();

export function withSidecarUsageContext<T>(context: SidecarUsageContext, fn: () => T): T {
	const parent = storage.getStore();
	return storage.run({ ...parent, ...context }, fn);
}

export function sidecarUsageContext(): SidecarUsageContext | undefined {
	return storage.getStore();
}

export function safeSidecarUsageSessionId(sessionId: string | undefined): string | undefined {
	const trimmed = sessionId?.trim();
	if (!trimmed) return undefined;
	const sanitized = trimmed
		.replace(/[^A-Za-z0-9._-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 128);
	if (!/[A-Za-z0-9]/.test(sanitized)) return undefined;
	return sanitized;
}

export function sidecarUsageRelativePath(sessionId: string | undefined): string {
	const safeSessionId = safeSidecarUsageSessionId(sessionId);
	const file = safeSessionId ? `${safeSessionId}.ndjson` : SIDECAR_USAGE_UNSCOPED_FILE;
	return join(SIDECAR_USAGE_DIR_RELATIVE_PATH, file);
}

export function usageFieldsFromUnknown(
	usage: unknown,
): Pick<SidecarUsageRecord, "input" | "cacheRead" | "cacheWrite" | "output" | "cost"> {
	if (!usage || typeof usage !== "object") {
		return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0 };
	}
	const value = usage as Record<string, unknown>;
	const cost = value.cost;
	return {
		input: numeric(value.input),
		cacheRead: numeric(value.cacheRead),
		cacheWrite: numeric(value.cacheWrite),
		output: numeric(value.output),
		cost: cost && typeof cost === "object" ? numeric((cost as { total?: unknown }).total) : numeric(cost),
	};
}

export function buildSidecarUsageRecord(
	input: SidecarUsageInput,
	now = () => new Date().toISOString(),
): SidecarUsageRecord {
	const context = storage.getStore();
	const record: SidecarUsageRecord = {
		ts: now(),
		agent: input.agent,
		trigger: String(input.trigger),
		status: String(input.status),
		provider: String(input.provider ?? ""),
		model: String(input.model ?? ""),
		input: numeric(input.input),
		cacheRead: numeric(input.cacheRead),
		cacheWrite: numeric(input.cacheWrite),
		output: numeric(input.output),
		cost: numeric(input.cost),
		durationMs: numeric(input.durationMs),
	};
	const sessionId = input.sessionId ?? context?.sessionId;
	if (sessionId) record.sessionId = String(sessionId);
	const threshold = input.threshold ?? context?.threshold;
	if (threshold !== undefined) record.threshold = numeric(threshold);
	return record;
}

/**
 * Append one usage record when a session has been bound. Missing context is a
 * deliberate no-op so unit tests that never enable recording cannot write into
 * the real agent directory.
 */
export function recordSidecarUsage(input: SidecarUsageInput): void {
	const context = storage.getStore();
	if (!context) return;
	try {
		const record = buildSidecarUsageRecord(input);
		const path = join(getAgentDir(), sidecarUsageRelativePath(record.sessionId));
		mkdirSync(dirname(path), { recursive: true });
		rotateIfNeeded(path);
		appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
	} catch {
		// Measurement must never change sidecar behavior.
	}
}

export type SidecarUsageTracker = {
	observeAssistant(message: unknown): void;
	observeEvent(event: unknown): void;
	finish(fallbackStatus: string): void;
};

export function startSidecarUsageTracker(identity: {
	agent: SidecarAgent;
	trigger: string;
	provider?: string;
	model?: string;
	threshold?: number;
	sessionId?: string;
}): SidecarUsageTracker {
	const started = Date.now();
	let last = started;
	let recorded = 0;
	const emit = (status: string, usage: unknown, durationMs: number) => {
		const context = storage.getStore();
		recordSidecarUsage({
			agent: identity.agent,
			trigger: context?.trigger ?? identity.trigger,
			status,
			provider: identity.provider,
			model: identity.model,
			threshold: identity.threshold ?? context?.threshold,
			sessionId: identity.sessionId ?? context?.sessionId,
			durationMs,
			...usageFieldsFromUnknown(usage),
		});
		recorded++;
	};
	const observeAssistant = (message: unknown) => {
		if (!isAssistantMessage(message)) return;
		const now = Date.now();
		emit(String(message.stopReason ?? "ok"), message.usage, now - last);
		last = now;
	};
	return {
		observeAssistant,
		observeEvent(event: unknown) {
			if (!event || typeof event !== "object") return;
			if ((event as { type?: string }).type !== "message_end") return;
			observeAssistant((event as { message?: unknown }).message);
		},
		finish(fallbackStatus: string) {
			if (recorded > 0) return;
			emit(fallbackStatus, undefined, Date.now() - started);
		},
	};
}

function isAssistantMessage(message: unknown): message is {
	role?: string;
	stopReason?: string;
	usage?: unknown;
} {
	return Boolean(message && typeof message === "object" && (message as { role?: string }).role === "assistant");
}

function numeric(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}

function rotateIfNeeded(path: string): void {
	if (!existsSync(path)) return;
	if (statSync(path).size < SIDECAR_USAGE_MAX_BYTES) return;
	const backupPath = `${path}.1`;
	if (existsSync(backupPath)) unlinkSync(backupPath);
	renameSync(path, backupPath);
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

const settingsPath = (): string => process.env.PI_VCC_CONFIG_PATH ?? join(getAgentDir(), "pi-vcc-config.json");
/** Backwards-compat export. Resolves at access time, not import time. */
const _SETTINGS_PATH = settingsPath();

/** Per-model or global compaction threshold. */
export interface ModelThreshold {
	/**
	 * Tokens to reserve for LLM response. Overrides pi-core's
	 * compaction.reserveTokens for matching models.
	 *
	 * This controls *when* compaction triggers:
	 *   contextTokens > contextWindow - reserveTokens
	 *
	 * A higher value compacts earlier (more conservative); a lower value
	 * lets context grow larger before compacting.
	 *
	 * Takes precedence over compactAtTokens and compactPercent when multiple are set.
	 */
	reserveTokens?: number;
	/**
	 * Absolute context token count where compaction triggers.
	 *
	 * This controls *when* compaction triggers:
	 *   contextTokens > compactAtTokens
	 *
	 * Useful when you want the same trigger point across models with
	 * different context windows. Ignored when reserveTokens is also set;
	 * takes precedence over compactPercent.
	 */
	compactAtTokens?: number;
	/**
	 * Compaction trigger as a percentage of context window (1–99).
	 * Compaction fires when: contextTokens > contextWindow × compactPercent / 100
	 *
	 * E.g. compactPercent: 65 means "compact when context is 65% full",
	 * equivalent to reserveTokens = 35% of contextWindow.
	 *
	 * Ignored when reserveTokens or compactAtTokens is also set.
	 */
	compactPercent?: number;
	/**
	 * Recent tokens to keep (not summarized) when pi-core handles compaction.
	 *
	 * Only affects pi-core's default compaction (when overrideDefaultCompaction
	 * is false). Pi-vcc's own buildOwnCut uses a deliverable-preserving suffix
	 * budget derived from the model window, not this field.
	 */
	keepRecentTokens?: number;
}

export interface PiVccSettings {
	/**
	 * When true, pi-vcc handles ALL compactions:
	 *   - /compact (no args)
	 *   - /compact <text>
	 *   - auto threshold / overflow
	 *   - /pi-vcc (always handled regardless)
	 *
	 * When false, pi-vcc only handles /pi-vcc; everything else
	 * falls back to pi core's default LLM-based compaction.
	 */
	overrideDefaultCompaction: boolean;
	/** Write debug snapshot to /tmp/pi-vcc-debug.json on each compaction. */
	debug: boolean;
	/**
	 * Per-model compaction thresholds. Keys are matched against
	 * "provider/modelId" (e.g., "neuralwatt/zai-org/GLM-5.1-FP8") or
	 * just "modelId" (e.g., "GLM-5.1-FP8").
	 *
	 * When a model matches, its reserveTokens/compactAtTokens/compactPercent
	 * overrides pi-core's global compaction.reserveTokens for the *when to
	 * compact* decision. This lets different models compact at different
	 * context fill levels or absolute token counts.
	 */
	modelThresholds?: Record<string, ModelThreshold>;
	/**
	 * Global threshold applied to all models not matched by modelThresholds.
	 * Uses reserveTokens, compactAtTokens, or compactPercent. If omitted,
	 * pi-core's global compaction settings apply (no override).
	 */
	globalThreshold?: ModelThreshold;
	/**
	 * @deprecated Use globalThreshold instead.
	 */
	defaultThreshold?: ModelThreshold;
}

const DEFAULT_SETTINGS: PiVccSettings = {
	overrideDefaultCompaction: true,
	debug: false,
};

/**
 * Applied at load time when the user file omits both `globalThreshold` and
 * `defaultThreshold`. Kept out of {@link DEFAULT_SETTINGS} so
 * {@link scaffoldSettings} does not pin today's value into existing files.
 */
export const DEFAULT_COMPACT_PERCENT = 68;

const DEFAULT_GLOBAL_THRESHOLD: ModelThreshold = { compactPercent: DEFAULT_COMPACT_PERCENT };

/**
 * Resolve the effective ModelThreshold for a given model.
 *
 * Lookup order:
 *  1. Exact match on "provider/modelId" key
 *  2. Exact match on "modelId" key
 *  3. globalThreshold from settings
 *  4. defaultThreshold from settings
 *  5. undefined (the caller decides whether to apply a package default)
 */
export function getModelThreshold(
	settings: PiVccSettings,
	model: { id: string; provider?: string } | undefined,
): ModelThreshold | undefined {
	if (!model) return settings.globalThreshold ?? settings.defaultThreshold;

	const providerModelId = model.provider ? `${model.provider}/${model.id}` : undefined;

	// Exact match on provider/modelId
	if (providerModelId && settings.modelThresholds?.[providerModelId]) {
		return settings.modelThresholds[providerModelId];
	}

	// Exact match on just modelId
	if (settings.modelThresholds?.[model.id]) {
		return settings.modelThresholds[model.id];
	}

	return settings.globalThreshold ?? settings.defaultThreshold;
}

/**
 * Resolve the effective reserveTokens for a threshold, handling both
 * absolute (reserveTokens) and percentage (compactPercent) modes.
 *
 * Returns the number of tokens to reserve, or undefined if the
 * threshold is not usable (no reserveTokens, no compactPercent,
 * or compactPercent out of range).
 */
export function resolveReserveTokens(threshold: ModelThreshold, contextWindow: number): number | undefined {
	if (threshold.reserveTokens != null) return threshold.reserveTokens;
	if (threshold.compactPercent != null && contextWindow > 0) {
		const pct = threshold.compactPercent;
		if (pct < 1 || pct > 99) return undefined;
		return Math.round(contextWindow * (1 - pct / 100));
	}
	return undefined;
}

/**
 * Resolve the context token count where compaction should trigger.
 *
 * Precedence: reserveTokens > compactAtTokens > compactPercent.
 * Returns undefined when the threshold cannot produce a usable trigger.
 */
export function resolveTriggerTokens(threshold: ModelThreshold, contextWindow: number): number | undefined {
	if (contextWindow <= 0) return undefined;

	if (threshold.reserveTokens != null) {
		return contextWindow - threshold.reserveTokens;
	}

	if (threshold.compactAtTokens != null) {
		const tokens = threshold.compactAtTokens;
		if (!Number.isFinite(tokens) || tokens < 1) return undefined;
		return Math.round(tokens);
	}

	const reserve = resolveReserveTokens(threshold, contextWindow);
	if (reserve == null) return undefined;
	return contextWindow - reserve;
}

const readJson = (path: string): Record<string, unknown> | null => {
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
};

const readPiCoreCompactionEnabled = (path: string): boolean | undefined => {
	const parsed = readJson(path);
	if (!parsed) return undefined;
	const enabled = (parsed as { compaction?: { enabled?: unknown } }).compaction?.enabled;
	return typeof enabled === "boolean" ? enabled : undefined;
};

/**
 * Read pi-core's effective `compaction.enabled` setting.
 *
 * pi-core's `_checkCompaction` bails immediately when this is false, so neither
 * overflow nor threshold auto-compaction fires. When that happens pi-vcc must
 * drive compaction itself via `ctx.compact()` (the manual path skips the
 * `enabled` gate). Mirrors pi-core's merge: project (`<cwd>/<CONFIG_DIR_NAME>/
 * settings.json`) overrides global (`<agentDir>/settings.json`); defaults true.
 */
export function isPiCoreCompactionEnabled(projectCwd?: string): boolean {
	const globalEnabled = readPiCoreCompactionEnabled(join(getAgentDir(), "settings.json"));
	if (projectCwd) {
		const projectEnabled = readPiCoreCompactionEnabled(join(projectCwd, CONFIG_DIR_NAME, "settings.json"));
		if (typeof projectEnabled === "boolean") return projectEnabled;
	}
	if (typeof globalEnabled === "boolean") return globalEnabled;
	return true;
}

export function loadSettings(): PiVccSettings {
	const parsed = readJson(settingsPath());
	if (!parsed || typeof parsed !== "object") {
		return { ...DEFAULT_SETTINGS, globalThreshold: DEFAULT_GLOBAL_THRESHOLD };
	}
	const loaded = { ...DEFAULT_SETTINGS, ...(parsed as Partial<PiVccSettings>) };
	// An explicit `globalThreshold` — including `{}` as opt-out — wins.
	// A file that only has the deprecated `defaultThreshold` keeps that value.
	// Omitting both applies the live package default without writing the file.
	if (!Object.hasOwn(parsed, "globalThreshold")) {
		loaded.globalThreshold = Object.hasOwn(parsed, "defaultThreshold")
			? (parsed as Partial<PiVccSettings>).defaultThreshold
			: DEFAULT_GLOBAL_THRESHOLD;
	}
	return loaded;
}

/**
 * Usage-token count at which VCC will request compaction for this model, or
 * `undefined` when VCC cannot evaluate a waterline (opted out, unusable
 * threshold, or unknown window).
 */
export function resolveUsageCompactionTrigger(
	model: { id?: string; provider?: string; contextWindow?: number } | undefined,
): number | undefined {
	const settings = loadSettings();
	const identity = model && typeof model.id === "string" ? { id: model.id, provider: model.provider } : undefined;
	const threshold = getModelThreshold(settings, identity);
	if (!threshold) return undefined;
	const contextWindow = typeof model?.contextWindow === "number" ? model.contextWindow : 0;
	return resolveTriggerTokens(threshold, contextWindow);
}

/** True only when VCC can actually evaluate the waterline this turn. */
export function hasEvaluableUsageThreshold(
	model: { id?: string; provider?: string; contextWindow?: number } | undefined,
	currentTokens: number | undefined,
): boolean {
	return currentTokens !== undefined && resolveUsageCompactionTrigger(model) !== undefined;
}

/**
 * Ensure the pi-vcc config file (default ~/.pi/agent/pi-vcc-config.json) exists with default keys.
 * - File missing → create with full default block.
 * - File exists but invalid JSON → no-op (don't clobber user file).
 * - File exists and valid → fill in missing default keys, preserve existing values.
 */
export function scaffoldSettings(): void {
	try {
		const path = settingsPath();
		const dir = dirname(path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		if (!existsSync(path)) {
			writeFileSync(path, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`);
			return;
		}

		const parsed = readJson(path);
		if (!parsed || typeof parsed !== "object") return; // don't clobber

		let changed = false;
		const next: Record<string, unknown> = { ...parsed };
		for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
			if (!(key in next)) {
				next[key] = value;
				changed = true;
			}
		}
		if (changed) writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
	} catch {
		// best-effort; never crash extension load
	}
}

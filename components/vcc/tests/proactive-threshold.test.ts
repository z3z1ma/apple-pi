import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProactiveThresholdHook, resetProactiveState } from "../src/hooks/proactive-threshold.js";

let tmpDir: string;
let CONFIG_PATH: string;
let AGENT_DIR: string;

beforeAll(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "pi-vcc-test-"));
	CONFIG_PATH = join(tmpDir, "pi-vcc-config.json");
	// Isolate pi-core's settings.json so tests don't read the user's real
	// ~/.pi/agent/settings.json. Default to compaction enabled; individual
	// tests override via setPiCoreCompactionEnabled().
	AGENT_DIR = join(tmpDir, "agent");
	mkdirSync(AGENT_DIR, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
	setPiCoreCompactionEnabled(true);
	process.env.PI_VCC_CONFIG_PATH = CONFIG_PATH;
});

afterAll(() => {
	delete process.env.PI_VCC_CONFIG_PATH;
	delete process.env.PI_CODING_AGENT_DIR;
	rmSync(tmpDir, { recursive: true, force: true });
});

function setPiCoreCompactionEnabled(enabled: boolean): void {
	writeFileSync(join(AGENT_DIR, "settings.json"), JSON.stringify({ compaction: { enabled } }));
}

interface MockResult {
	piApi: any; // the object passed to registerProactiveThresholdHook(pi)
	ctx: any;
	emit: (eventName: string, event?: any) => void;
	captured: { method: string; args: any[] }[];
	notifyCalls: { msg: string; level: string }[];
}

function createMockPi(
	model?: { id: string; provider?: string; contextWindow?: number },
	usage?: { tokens: number | null; contextWindow: number; percent: number | null },
): MockResult {
	const captured: { method: string; args: any[] }[] = [];
	const notifyCalls: { msg: string; level: string }[] = [];
	const handlers: Record<string, ((e: any, c: any) => any)[]> = {};

	const ctx = {
		hasUI: true,
		model: model ?? undefined,
		ui: {
			notify: (msg: string, level: string) => {
				notifyCalls.push({ msg, level });
			},
		},
		getContextUsage: () => usage ?? { tokens: null, contextWindow: 0, percent: null },
		compact: () => {
			captured.push({ method: "compact", args: [] });
		},
	};

	const piApi = {
		on: (eventName: string, handler: (e: any, c: any) => any) => {
			if (!handlers[eventName]) handlers[eventName] = [];
			handlers[eventName].push(handler);
		},
	};

	const emit = (eventName: string, event: any = {}) => {
		const hs = handlers[eventName] ?? [];
		for (const h of hs) h(event, ctx);
	};

	return { piApi, ctx, emit, captured, notifyCalls };
}

function setConfig(cfg: Record<string, unknown>) {
	writeFileSync(CONFIG_PATH, JSON.stringify(cfg));
}

describe("proactiveThreshold: agent_settled", () => {
	afterEach(() => {
		resetProactiveState();
		if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
	});

	test("triggers compact when context exceeds per-model threshold", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);
		expect(mock.captured[0].method).toBe("compact");
		expect(mock.notifyCalls.length).toBeGreaterThanOrEqual(1);
		expect(mock.notifyCalls[0].msg).toContain("auto");
	});

	test("does not request compact on agent_end when only the usage waterline is crossed", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_end", { type: "agent_end", messages: [] });
		expect(mock.captured).toHaveLength(0);
	});

	test("does NOT trigger when the live branch already ends with a compaction", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		mock.ctx.sessionManager = {
			getBranch: () => [{ type: "message" }, { type: "compaction" }],
		};
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
		expect(mock.notifyCalls).toHaveLength(0);
	});

	test("does NOT trigger when context is below threshold", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 80000, contextWindow: 128000, percent: 63 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});

	test("triggers at the package default compactPercent when no threshold is configured", () => {
		setConfig({ debug: false, overrideDefaultCompaction: true });
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);
	});

	test("does not apply the package default below 68% of the configured window", () => {
		setConfig({ debug: false, overrideDefaultCompaction: true });
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 200000 },
			{ tokens: 135000, contextWindow: 200000, percent: 68 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});

	test("an empty globalThreshold opts out of the package default", () => {
		setConfig({ debug: false, overrideDefaultCompaction: true, globalThreshold: {} });
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});

	test("does NOT trigger when context usage tokens is null", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: null, contextWindow: 128000, percent: null },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});

	test("does NOT trigger when contextWindow is 0", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 0 },
			{ tokens: 50000, contextWindow: 0, percent: null },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});
});

describe("proactiveThreshold: model_select", () => {
	afterEach(() => {
		resetProactiveState();
		if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
	});

	test("triggers compact on model switch when context exceeds new model's threshold", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("model_select", { type: "model_select" });
		expect(mock.captured).toHaveLength(1);
		expect(mock.notifyCalls[0].msg).toContain("model-switch");
	});

	test("does NOT trigger when context is below threshold after model switch", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 80000, contextWindow: 128000, percent: 63 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("model_select", { type: "model_select" });
		expect(mock.captured).toHaveLength(0);
	});

	test("uses globalThreshold when model does not match modelThresholds", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			globalThreshold: { reserveTokens: 16384 },
		});
		const mock = createMockPi(
			{ id: "unknown-model", provider: "other", contextWindow: 128000 },
			{ tokens: 120000, contextWindow: 128000, percent: 94 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("model_select", { type: "model_select" });
		expect(mock.captured).toHaveLength(1);
	});

	test("uses globalThreshold with compactPercent", () => {
		// compactPercent: 65 → reserve = 128000 * 0.35 = 44800 → threshold = 83200
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			globalThreshold: { compactPercent: 65 },
		});
		const mock = createMockPi(
			{ id: "unknown-model", provider: "other", contextWindow: 128000 },
			{ tokens: 90000, contextWindow: 128000, percent: 70 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("model_select", { type: "model_select" });
		expect(mock.captured).toHaveLength(1);
	});

	test("uses compactPercent in modelThresholds", () => {
		// compactPercent: 65 → reserve = 128000 * 0.35 = 44800 → threshold = 83200
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { compactPercent: 65 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 90000, contextWindow: 128000, percent: 70 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);
	});

	test("does not trigger when context is below compactPercent threshold", () => {
		// compactPercent: 65 → threshold = 83200
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { compactPercent: 65 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 70000, contextWindow: 128000, percent: 55 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});

	test("falls back to defaultThreshold when globalThreshold is not set", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			defaultThreshold: { reserveTokens: 16384 },
		});
		const mock = createMockPi(
			{ id: "unknown-model", provider: "other", contextWindow: 128000 },
			{ tokens: 120000, contextWindow: 128000, percent: 94 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("model_select", { type: "model_select" });
		expect(mock.captured).toHaveLength(1);
	});
});

describe("proactiveThreshold: compactAtTokens", () => {
	afterEach(() => {
		resetProactiveState();
		if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
	});

	test("triggers from globalThreshold when context exceeds compactAtTokens", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			globalThreshold: { compactAtTokens: 150000 },
		});
		const mock = createMockPi(
			{ id: "unknown-model", provider: "other", contextWindow: 1000000 },
			{ tokens: 150001, contextWindow: 1000000, percent: 15 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);
		expect(mock.notifyCalls[0].msg).toContain("150.0k tok");
	});

	test("does NOT trigger from globalThreshold when context equals compactAtTokens", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			globalThreshold: { compactAtTokens: 150000 },
		});
		const mock = createMockPi(
			{ id: "unknown-model", provider: "other", contextWindow: 1000000 },
			{ tokens: 150000, contextWindow: 1000000, percent: 15 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});

	test("triggers from modelThresholds when context exceeds compactAtTokens", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/glm-5.1-long": { compactAtTokens: 150000 },
			},
		});
		const mock = createMockPi(
			{ id: "glm-5.1-long", provider: "neuralwatt", contextWindow: 1000000 },
			{ tokens: 150001, contextWindow: 1000000, percent: 15 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);
	});

	test("reserveTokens takes precedence over compactAtTokens", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			globalThreshold: { reserveTokens: 50000, compactAtTokens: 100000 },
		});
		const mock = createMockPi(
			{ id: "unknown-model", provider: "other", contextWindow: 200000 },
			{ tokens: 120000, contextWindow: 200000, percent: 60 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});

	test("compactAtTokens takes precedence over compactPercent", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			globalThreshold: { compactAtTokens: 150000, compactPercent: 65 },
		});
		const mock = createMockPi(
			{ id: "unknown-model", provider: "other", contextWindow: 200000 },
			{ tokens: 140000, contextWindow: 200000, percent: 70 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});

	test("does NOT trigger for invalid compactAtTokens", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			globalThreshold: { compactAtTokens: 0 },
		});
		const mock = createMockPi(
			{ id: "unknown-model", provider: "other", contextWindow: 200000 },
			{ tokens: 190000, contextWindow: 200000, percent: 95 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});
});

describe("proactiveThreshold: cooldown", () => {
	afterEach(() => {
		resetProactiveState();
		if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
	});

	test("does NOT double-trigger within cooldown after compaction", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);

		// First trigger: agent_settled causes compact
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);

		// session_compact fires (compaction completed) — sets cooldown
		mock.emit("session_compact", { type: "session_compact", compactionEntry: {} });

		// Second trigger: model_select within cooldown — blocked
		mock.emit("model_select", { type: "model_select" });
		expect(mock.captured).toHaveLength(1); // still 1, not 2
	});

	test("re-triggers after cooldown expires", async () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);

		// First trigger
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);

		// session_compact sets cooldown
		mock.emit("session_compact", { type: "session_compact", compactionEntry: {} });

		// Wait for cooldown to expire (3s + buffer)
		await new Promise((r) => setTimeout(r, 3200));

		// Second trigger should now work
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(2);
	}, 10000);
});

describe("proactiveThreshold: modelId matching", () => {
	afterEach(() => {
		resetProactiveState();
		if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
	});

	test("matches on provider/modelId", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);
	});

	test("matches on modelId only when provider/modelId doesn't match", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "other-provider", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);
	});

	test("unlisted models fall back to the package default, not to no threshold", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "Kimi-K2.6", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);
	});

	test("empty globalThreshold keeps unmatched modelThresholds from applying a default", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			globalThreshold: {},
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "Kimi-K2.6", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});
});

describe("proactiveThreshold: exact boundary", () => {
	afterEach(() => {
		resetProactiveState();
		if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
	});

	test("does NOT trigger when tokens exactly equal threshold", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		// 128000 - 32768 = 95232 → exactly at threshold, NOT exceeded
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 95232, contextWindow: 128000, percent: 74 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});

	test("triggers when tokens exceed threshold by 1", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		// 128000 - 32768 = 95232 → just over
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 95233, contextWindow: 128000, percent: 74 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(1);
	});
});

describe("proactiveThreshold: without model", () => {
	afterEach(() => {
		resetProactiveState();
		if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
	});

	test("does NOT trigger when model is undefined", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: true,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(undefined, { tokens: 110000, contextWindow: 128000, percent: 86 });
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		expect(mock.captured).toHaveLength(0);
	});
});

describe("proactiveThreshold: works for pi-core compaction too", () => {
	afterEach(() => {
		resetProactiveState();
		if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
	});

	test("proactive trigger works even when overrideDefaultCompaction is false", () => {
		setConfig({
			debug: false,
			overrideDefaultCompaction: false,
			modelThresholds: {
				"neuralwatt/GLM-5.1": { reserveTokens: 32768 },
			},
		});
		const mock = createMockPi(
			{ id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
			{ tokens: 110000, contextWindow: 128000, percent: 86 },
		);
		registerProactiveThresholdHook(mock.piApi);
		mock.emit("agent_settled", { type: "agent_settled" });
		// Should still trigger compact — ctx.compact() will invoke pi-core's compaction
		expect(mock.captured).toHaveLength(1);
	});
});

describe("proactiveThreshold: Codex recovery errors", () => {
	afterEach(() => {
		resetProactiveState();
		if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
		setPiCoreCompactionEnabled(true);
	});

	test("forces compaction without a configured threshold", () => {
		setConfig({ debug: false, overrideDefaultCompaction: true });
		const mock = createMockPi(
			{ id: "luna", provider: "openai-codex", contextWindow: 272000 },
			{ tokens: null, contextWindow: 272000, percent: null },
		);
		registerProactiveThresholdHook(mock.piApi);

		mock.emit("agent_end", {
			type: "agent_end",
			messages: [
				{
					role: "assistant",
					api: "openai-codex-responses",
					provider: "openai-codex",
					stopReason: "error",
					errorMessage:
						"Model stopped because it reached the maximum output token limit. The response may be incomplete.",
				},
			],
		});

		expect(mock.captured).toHaveLength(1);
		expect(mock.notifyCalls[0].msg).toContain("maximum output token limit");
	});

	test("does not force compaction for unrelated Codex errors", () => {
		setConfig({ debug: false, overrideDefaultCompaction: true });
		const mock = createMockPi(
			{ id: "luna", provider: "openai-codex", contextWindow: 272000 },
			{ tokens: null, contextWindow: 272000, percent: null },
		);
		registerProactiveThresholdHook(mock.piApi);

		mock.emit("agent_end", {
			type: "agent_end",
			messages: [
				{
					role: "assistant",
					api: "openai-codex-responses",
					provider: "openai-codex",
					stopReason: "error",
					errorMessage: "Codex request failed",
				},
			],
		});

		expect(mock.captured).toHaveLength(0);
	});

	test("forces compaction when Codex omits model identity from context overflow", () => {
		setConfig({ debug: false, overrideDefaultCompaction: true });
		const mock = createMockPi(
			{ id: "luna", provider: "openai-codex", contextWindow: 272000 },
			{ tokens: null, contextWindow: 272000, percent: null },
		);
		registerProactiveThresholdHook(mock.piApi);

		mock.emit("agent_end", {
			type: "agent_end",
			messages: [
				{
					role: "assistant",
					api: "openai-codex-responses",
					provider: "openai-codex",
					stopReason: "error",
					errorMessage:
						"Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.",
				},
			],
		});

		expect(mock.captured).toHaveLength(1);
		expect(mock.notifyCalls[0].msg).toContain("context window");
	});

	test("does not force compaction when pi-core is enabled and identity matches", () => {
		setConfig({ debug: false, overrideDefaultCompaction: true });
		setPiCoreCompactionEnabled(true);
		const mock = createMockPi(
			{ id: "luna", provider: "openai-codex", contextWindow: 272000 },
			{ tokens: null, contextWindow: 272000, percent: null },
		);
		registerProactiveThresholdHook(mock.piApi);

		mock.emit("agent_end", {
			type: "agent_end",
			messages: [
				{
					role: "assistant",
					api: "openai-codex-responses",
					provider: "openai-codex",
					model: "luna",
					stopReason: "error",
					errorMessage:
						"Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.",
				},
			],
		});

		// pi-core owns the overflow compaction here; pi-vcc defers.
		expect(mock.captured).toHaveLength(0);
	});

	test("forces compaction when pi-core compaction is disabled even with matching identity", () => {
		setConfig({ debug: false, overrideDefaultCompaction: true });
		setPiCoreCompactionEnabled(false);
		const mock = createMockPi(
			{ id: "luna", provider: "openai-codex", contextWindow: 272000 },
			{ tokens: null, contextWindow: 272000, percent: null },
		);
		registerProactiveThresholdHook(mock.piApi);

		mock.emit("agent_end", {
			type: "agent_end",
			messages: [
				{
					role: "assistant",
					api: "openai-codex-responses",
					provider: "openai-codex",
					model: "luna",
					stopReason: "error",
					errorMessage:
						"Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.",
				},
			],
		});

		// pi-core's _checkCompaction bails on `enabled: false`; pi-vcc must drive.
		expect(mock.captured).toHaveLength(1);
		expect(mock.notifyCalls[0].msg).toContain("context window");
	});

	test("does not force Codex recovery compact when the branch already ends with a compaction", () => {
		setConfig({ debug: false, overrideDefaultCompaction: true });
		const mock = createMockPi(
			{ id: "luna", provider: "openai-codex", contextWindow: 272000 },
			{ tokens: null, contextWindow: 272000, percent: null },
		);
		mock.ctx.sessionManager = {
			getBranch: () => [{ type: "compaction" }],
		};
		registerProactiveThresholdHook(mock.piApi);

		mock.emit("agent_end", {
			type: "agent_end",
			messages: [
				{
					role: "assistant",
					api: "openai-codex-responses",
					provider: "openai-codex",
					stopReason: "error",
					errorMessage:
						"Model stopped because it reached the maximum output token limit. The response may be incomplete.",
				},
			],
		});

		expect(mock.captured).toHaveLength(0);
		expect(mock.notifyCalls).toHaveLength(0);
	});
});

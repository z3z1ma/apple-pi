import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_COMPACT_PERCENT,
	hasEvaluableUsageThreshold,
	loadSettings,
	resolveTriggerTokens,
	resolveUsageCompactionTrigger,
} from "../src/core/settings.js";

let tmpDir: string;
let configPath: string;
const previousConfigPath = process.env.PI_VCC_CONFIG_PATH;

function writeConfig(value: Record<string, unknown>): void {
	writeFileSync(configPath, `${JSON.stringify(value)}\n`);
}

beforeAll(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "pi-vcc-settings-load-"));
	configPath = join(tmpDir, "pi-vcc-config.json");
	mkdirSync(tmpDir, { recursive: true });
	process.env.PI_VCC_CONFIG_PATH = configPath;
});

afterAll(() => {
	if (previousConfigPath === undefined) delete process.env.PI_VCC_CONFIG_PATH;
	else process.env.PI_VCC_CONFIG_PATH = previousConfigPath;
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadSettings default usage waterline", () => {
	test("missing file applies the live package default without scaffolding a threshold key", () => {
		rmSync(configPath, { force: true });
		expect(loadSettings().globalThreshold).toEqual({ compactPercent: DEFAULT_COMPACT_PERCENT });
	});

	test("omitted globalThreshold applies the live package default", () => {
		writeConfig({ overrideDefaultCompaction: true, debug: false });
		expect(loadSettings().globalThreshold).toEqual({ compactPercent: DEFAULT_COMPACT_PERCENT });
	});

	test("empty globalThreshold opts out", () => {
		writeConfig({ overrideDefaultCompaction: true, globalThreshold: {} });
		expect(loadSettings().globalThreshold).toEqual({});
		expect(resolveUsageCompactionTrigger({ id: "any", contextWindow: 200000 })).toBeUndefined();
	});

	test("deprecated defaultThreshold is preserved when globalThreshold is omitted", () => {
		writeConfig({ overrideDefaultCompaction: true, defaultThreshold: { compactPercent: 50 } });
		expect(loadSettings().globalThreshold).toEqual({ compactPercent: 50 });
	});

	test("explicit globalThreshold wins over defaultThreshold", () => {
		writeConfig({
			overrideDefaultCompaction: true,
			globalThreshold: { compactPercent: 60 },
			defaultThreshold: { compactPercent: 50 },
		});
		expect(loadSettings().globalThreshold).toEqual({ compactPercent: 60 });
	});
});

describe("hasEvaluableUsageThreshold", () => {
	test("is false when usage tokens are unavailable", () => {
		writeConfig({ overrideDefaultCompaction: true });
		expect(hasEvaluableUsageThreshold({ id: "any", contextWindow: 200000 }, undefined)).toBe(false);
	});

	test("is false when the user opted out", () => {
		writeConfig({ overrideDefaultCompaction: true, globalThreshold: {} });
		expect(hasEvaluableUsageThreshold({ id: "any", contextWindow: 200000 }, 180000)).toBe(false);
	});

	test("is true when usage and a resolvable window exist", () => {
		writeConfig({ overrideDefaultCompaction: true });
		expect(hasEvaluableUsageThreshold({ id: "any", contextWindow: 200000 }, 135000)).toBe(true);
	});
});

describe("resolveUsageCompactionTrigger", () => {
	test("scales with the configured context window", () => {
		writeConfig({ overrideDefaultCompaction: true });
		expect(resolveUsageCompactionTrigger({ id: "any", contextWindow: 200000 })).toBe(
			resolveTriggerTokens({ compactPercent: DEFAULT_COMPACT_PERCENT }, 200000),
		);
		expect(resolveUsageCompactionTrigger({ id: "any", contextWindow: 100000 })).toBe(
			resolveTriggerTokens({ compactPercent: DEFAULT_COMPACT_PERCENT }, 100000),
		);
		expect(resolveUsageCompactionTrigger({ id: "any", contextWindow: 200000 })).toBe(136000);
		expect(resolveUsageCompactionTrigger({ id: "any", contextWindow: 100000 })).toBe(68000);
	});
});

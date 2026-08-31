import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TODOS_CONFIG } from "../src/config.js";
import type { TodosConfig } from "../src/types.js";
import { openSettingsMenu, saveProjectTodosConfig, type SettingsUI } from "../src/ui/settings-menu.js";

describe("saveProjectTodosConfig", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `test-todos-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	});

	afterEach(() => rmSync(testDir, { recursive: true, force: true }));

	it("creates and saves sparse trusted project overrides", () => {
		const overrides: TodosConfig = { storage: "project", autoCascade: true };
		saveProjectTodosConfig(overrides, testDir, true);
		expect(JSON.parse(readFileSync(join(testDir, ".pi", "todos.json"), "utf8"))).toEqual(overrides);
	});

	it("never turns an untrusted project edit into global configuration", () => {
		expect(() => saveProjectTodosConfig({ storage: "project" }, testDir, false)).toThrow(/trusted project/);
		expect(existsSync(join(testDir, ".pi", "todos.json"))).toBe(false);
	});
});

describe("openSettingsMenu", () => {
	it("renders trusted project settings and returns", async () => {
		let capturedFactory: any;
		const ui: SettingsUI = {
			custom: vi.fn().mockImplementation((factory) => {
				capturedFactory = factory;
				return Promise.resolve();
			}),
		};
		const onBack = vi.fn().mockResolvedValue(undefined);
		await openSettingsMenu(
			ui,
			{ ...DEFAULT_TODOS_CONFIG },
			{},
			{ ...DEFAULT_TODOS_CONFIG },
			"/tmp",
			true,
			onBack,
			vi.fn(),
		);
		expect(ui.custom).toHaveBeenCalled();
		expect(onBack).toHaveBeenCalled();
		const root = capturedFactory(
			{},
			{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
			{},
			vi.fn(),
		);
		expect(root).toBeDefined();
	});

	it("rejects an untrusted interactive editor", async () => {
		const ui = { custom: vi.fn() } as unknown as SettingsUI;
		await expect(
			openSettingsMenu(
				ui,
				{ ...DEFAULT_TODOS_CONFIG },
				{},
				{ ...DEFAULT_TODOS_CONFIG },
				"/tmp",
				false,
				async () => {},
				vi.fn(),
			),
		).rejects.toThrow(/trusted project/);
		expect(ui.custom).not.toHaveBeenCalled();
	});
});

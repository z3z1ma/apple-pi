import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { NO_FALLBACK } from "./agent-types.js";
import type { JoinMode, WidgetMode } from "./types.js";

export interface SubagentsSettings {
	maxConcurrent?: number;
	defaultMaxTurns?: number;
	graceTurns?: number;
	defaultJoinMode?: JoinMode;
	strictAgentFiles?: boolean;
	disableDefaultAgents?: boolean;
	fleetView?: boolean;
	persistAgentSessions?: boolean;
	widgetMode?: WidgetMode;
	maxSubagentDepth?: number;
	fallbackSubagent?: string;
}

export interface SettingsAppliers {
	setMaxConcurrent: (n: number) => void;
	setDefaultMaxTurns: (n: number) => void;
	setGraceTurns: (n: number) => void;
	setDefaultJoinMode: (mode: JoinMode) => void;
	setStrictAgentFiles: (enabled: boolean) => void;
	setDisableDefaultAgents: (enabled: boolean) => void;
	setFleetView: (enabled: boolean) => void;
	setPersistAgentSessions: (enabled: boolean) => void;
	setWidgetMode: (mode: WidgetMode) => void;
	setMaxSubagentDepth: (n: number) => void;
	setFallbackSubagent: (value: string | undefined) => void;
}

const JOIN_MODES = new Set<JoinMode>(["async", "group", "smart"]);
const WIDGET_MODES = new Set<WidgetMode>(["all", "background", "off"]);

function sanitize(raw: unknown): SubagentsSettings {
	if (!raw || typeof raw !== "object") return {};
	const value = raw as Record<string, unknown>;
	const result: SubagentsSettings = {};
	if (
		Number.isInteger(value.maxConcurrent) &&
		Number(value.maxConcurrent) >= 1 &&
		Number(value.maxConcurrent) <= 1024
	) {
		result.maxConcurrent = Number(value.maxConcurrent);
	}
	if (
		Number.isInteger(value.defaultMaxTurns) &&
		Number(value.defaultMaxTurns) >= 0 &&
		Number(value.defaultMaxTurns) <= 10_000
	) {
		result.defaultMaxTurns = Number(value.defaultMaxTurns);
	}
	if (Number.isInteger(value.graceTurns) && Number(value.graceTurns) >= 1 && Number(value.graceTurns) <= 1_000) {
		result.graceTurns = Number(value.graceTurns);
	}
	if (
		Number.isInteger(value.maxSubagentDepth) &&
		Number(value.maxSubagentDepth) >= 0 &&
		Number(value.maxSubagentDepth) <= 16
	) {
		result.maxSubagentDepth = Number(value.maxSubagentDepth);
	}
	if (typeof value.defaultJoinMode === "string" && JOIN_MODES.has(value.defaultJoinMode as JoinMode)) {
		result.defaultJoinMode = value.defaultJoinMode as JoinMode;
	}
	if (typeof value.widgetMode === "string" && WIDGET_MODES.has(value.widgetMode as WidgetMode)) {
		result.widgetMode = value.widgetMode as WidgetMode;
	}
	for (const key of ["strictAgentFiles", "disableDefaultAgents", "fleetView", "persistAgentSessions"] as const) {
		if (typeof value[key] === "boolean") result[key] = value[key];
	}
	if (value.fallbackSubagent === false) result.fallbackSubagent = NO_FALLBACK;
	else if (typeof value.fallbackSubagent === "string" && value.fallbackSubagent.trim()) {
		result.fallbackSubagent = value.fallbackSubagent.trim();
	}
	return result;
}

function readSettingsFile(path: string): SubagentsSettings {
	if (!existsSync(path)) return {};
	try {
		return sanitize(JSON.parse(readFileSync(path, "utf-8")));
	} catch (error) {
		console.warn(
			`[apple-pi/subagents] Ignoring malformed settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return {};
	}
}

export function loadSettings(cwd = process.cwd()): SubagentsSettings {
	return {
		...readSettingsFile(join(getAgentDir(), "subagents.json")),
		...readSettingsFile(join(cwd, ".pi", "subagents.json")),
	};
}

export function saveSettings(settings: SubagentsSettings, cwd = process.cwd()): boolean {
	const path = join(cwd, ".pi", "subagents.json");
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
		return true;
	} catch {
		return false;
	}
}

export function applySettings(settings: SubagentsSettings, appliers: SettingsAppliers): void {
	if (settings.maxConcurrent !== undefined) appliers.setMaxConcurrent(settings.maxConcurrent);
	if (settings.defaultMaxTurns !== undefined) appliers.setDefaultMaxTurns(settings.defaultMaxTurns);
	if (settings.graceTurns !== undefined) appliers.setGraceTurns(settings.graceTurns);
	if (settings.defaultJoinMode) appliers.setDefaultJoinMode(settings.defaultJoinMode);
	if (settings.strictAgentFiles !== undefined) appliers.setStrictAgentFiles(settings.strictAgentFiles);
	if (settings.disableDefaultAgents !== undefined) appliers.setDisableDefaultAgents(settings.disableDefaultAgents);
	if (settings.fleetView !== undefined) appliers.setFleetView(settings.fleetView);
	if (settings.persistAgentSessions !== undefined) appliers.setPersistAgentSessions(settings.persistAgentSessions);
	if (settings.widgetMode) appliers.setWidgetMode(settings.widgetMode);
	if (settings.maxSubagentDepth !== undefined) appliers.setMaxSubagentDepth(settings.maxSubagentDepth);
	if (settings.fallbackSubagent !== undefined) appliers.setFallbackSubagent(settings.fallbackSubagent);
}

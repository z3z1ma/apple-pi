/**
 * custom-agents.ts — Load user-defined agents from project (.pi/agents/, plus the shared .agents/agents/ workspace) and global ($PI_CODING_AGENT_DIR/agents/, default ~/.pi/agent/agents/) locations.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOL_NAMES } from "./agent-types.js";
import type { AgentConfig, SubagentConfigScope } from "./types.js";

const RESERVED_IN_TYPE = ":";

/**
 * Scan for custom agent .md files from multiple locations.
 * Discovery hierarchy (higher priority wins):
 *   1. Project:   <cwd>/.pi/agents/*.md (authoritative — also where /agents writes)
 *   2. Workspace: <cwd>/.agents/agents/*.md (shared cross-tool .agents workspace, read-only)
 *   3. Global:    $PI_CODING_AGENT_DIR/agents/*.md (default: ~/.pi/agent/agents/*.md)
 *
 * Project-level agents override global ones with the same name. On a name clash
 * between the two project locations, .pi/agents wins — .pi stays the project
 * authority; .agents/agents is an additional read location.
 * Any name is allowed — names matching defaults (e.g. "Explore") override them.
 *
 * An agent's type comes from its required frontmatter `name:`. Two files can
 * claim the same name; the later load wins.
 */
export function loadCustomAgents(scope: SubagentConfigScope, strict = false): Map<string, AgentConfig> {
	const globalDir = join(getAgentDir(), "agents");
	const workspaceProjectDir = join(scope.cwd, ".agents", "agents");
	const projectDir = join(scope.cwd, ".pi", "agents");

	const agents = new Map<string, AgentConfig>();
	loadFromDir(globalDir, agents, "global", strict); // lowest priority
	if (scope.projectTrusted) {
		loadFromDir(workspaceProjectDir, agents, "project", strict); // shared workspace
		loadFromDir(projectDir, agents, "project", strict); // highest priority (overwrites)
	}

	warnedLastLoad = warnedThisLoad;
	warnedThisLoad = new Set();
	return agents;
}

/** Load agent configs from a directory into the map. */
function loadFromDir(
	dir: string,
	agents: Map<string, AgentConfig>,
	source: "project" | "global",
	strict: boolean,
): void {
	if (!existsSync(dir)) return;

	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".md"));
	} catch {
		return;
	}

	for (const file of files) {
		const path = join(dir, file);

		const parsed = readAgentFile(path, strict);
		if (!parsed) continue;
		const { frontmatter: fm, body } = parsed;

		const name = str(fm.name)?.trim();
		if (!name || name.includes(RESERVED_IN_TYPE)) {
			warnIfNew(`Skipping agent file ${path}: name must be a non-empty string without "${RESERVED_IN_TYPE}".`);
			continue;
		}

		if (fm.model !== undefined || fm.thinking !== undefined) {
			const message = `${path}: agent definitions select a model profile; raw model/thinking fields are not supported`;
			if (strict) throw new Error(message);
			warnIfNew(`Skipping agent file ${message}`);
			continue;
		}
		const rawProfile = str(fm.profile);
		const profile = rawProfile?.trim();
		if (fm.profile !== undefined && (!profile || profile !== rawProfile)) {
			const message = `${path}: profile must be a non-empty, unpadded string`;
			if (strict) throw new Error(message);
			warnIfNew(`Skipping agent file ${message}`);
			continue;
		}

		const { builtinToolNames, extSelectors } = parseToolsField(fm.tools);

		agents.set(name, {
			name,
			// `name` is the type; `display_name` is only the optional UI label.
			displayName: str(fm.display_name),
			color: str(fm.color),
			description: str(fm.description) ?? name,
			builtinToolNames,
			extSelectors,
			disallowedTools: csvListOptional(fm.disallowed_tools),
			extensions: inheritField(fm.extensions),
			excludeExtensions: csvListOptional(fm.exclude_extensions),
			skills: inheritField(fm.skills),
			profile,
			maxTurns: nonNegativeInt(fm.max_turns),
			persistSession: fm.persist_session != null ? fm.persist_session === true : undefined,
			sessionDir: str(fm.session_dir),
			advisor: typeof fm.advisor === "boolean" ? fm.advisor : undefined,
			allowedSubagents: parseAllowedSubagents(fm.allowed_subagents),
			systemPrompt: body.trim(),
			promptMode: fm.prompt_mode === "append" ? "append" : "replace",
			enabled: fm.enabled !== false, // default true; explicitly false disables
			source,
			sourcePath: path,
		});
	}
}

/**
 * Read and parse one agent file, or warn and return undefined for the caller to
 * skip. One bad file must not take the whole extension down with it — an
 * unparseable `.md` used to abort activation, so pi exited before the TUI.
 *
 * The path is as much of the fix as the recovery: a bare YAML error ("line 2,
 * column 14") is unactionable when agents come from three directories at once,
 * and the only other symptom is `Unknown agent type`, which reads like a typo.
 *
 * Under `strict` the same failure rethrows, still naming the path, so callers
 * that opted into failing closed stop rather than run a substituted agent.
 */
function readAgentFile(
	path: string,
	strict: boolean,
): { frontmatter: Record<string, unknown>; body: string } | undefined {
	try {
		return parseFrontmatter<Record<string, unknown>>(readFileSync(path, "utf-8"));
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		if (strict) throw new Error(`${path}: ${reason}`);
		warnIfNew(`Skipping agent file ${path}: ${reason}`);
		return undefined;
	}
}

let warnedLastLoad = new Set<string>();
let warnedThisLoad = new Set<string>();

/**
 * Agents reload on activation and again on every `Agent` call, so an unchanged
 * problem would re-warn all session — over a painted TUI, since pi does not
 * redirect console output. Compare against the previous load rather than every
 * load ever, so a file that is fixed and then broken again still reports.
 */
function warnIfNew(message: string): void {
	warnedThisLoad.add(message);
	if (warnedLastLoad.has(message)) return;
	console.warn(`[pi-subagents] ${message}`);
}

// ---- Field parsers ----

/** Extract a string or undefined. */
function str(val: unknown): string | undefined {
	return typeof val === "string" ? val : undefined;
}

/** Extract a non-negative integer or undefined. 0 means unlimited for max_turns. */
function nonNegativeInt(val: unknown): number | undefined {
	return typeof val === "number" && val >= 0 ? val : undefined;
}

/**
 * Parse a raw CSV field value into items, or undefined if absent or empty.
 */
function parseCsvField(val: unknown): string[] | undefined {
	if (typeof val !== "string") return undefined;
	const s = val.trim();
	if (!s) return undefined;
	const items = s
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

/**
 * Parse the nested-delegation allowlist. Omitted or empty means no nested
 * tools; the exact string "all" permits every enabled type; otherwise CSV
 * names permit those types only.
 */
function parseAllowedSubagents(val: unknown): "all" | string[] | undefined {
	const items = parseCsvField(val);
	if (!items) return undefined;
	return items.length === 1 && items[0] === "all" ? "all" : items;
}

/**
 * Parse a comma-separated list field with defaults.
 * omitted → defaults; empty → []; CSV → listed items.
 */
function csvList(val: unknown, defaults: string[]): string[] {
	if (val === undefined) return defaults;
	return parseCsvField(val) ?? [];
}

/**
 * Partition the `tools:` CSV into the built-in tool allowlist and raw `ext:` selectors.
 * `*` expands to all built-ins; plain entries are built-in names; `ext:` entries are extension-tool
 * selectors parsed later by the runner. omitted → all built-ins, no selectors.
 * `tools:` present with only `ext:` entries → zero built-ins (use `*`).
 */
function parseToolsField(val: unknown): { builtinToolNames: string[]; extSelectors: string[] | undefined } {
	const entries = csvList(val, BUILTIN_TOOL_NAMES);
	const isWildcard = (e: string) => e === "*";
	const hasWildcard = entries.some(isWildcard);
	const plain = entries.filter((e) => !isWildcard(e) && !e.startsWith("ext:"));
	const extEntries = entries.filter((e) => e.startsWith("ext:"));
	return {
		builtinToolNames: hasWildcard ? [...new Set([...BUILTIN_TOOL_NAMES, ...plain])] : plain,
		extSelectors: extEntries.length > 0 ? extEntries : undefined,
	};
}

/**
 * Parse an optional comma-separated list field.
 * omitted or empty → undefined; CSV → listed items.
 */
function csvListOptional(val: unknown): string[] | undefined {
	return parseCsvField(val);
}

/**
 * Parse an inherit field (extensions, skills).
 * omitted/true → true (inherit all); false or empty → false; CSV → listed names.
 */
function inheritField(val: unknown): true | string[] | false {
	if (val === undefined || val === true) return true;
	if (val === false) return false;
	const items = csvList(val, []);
	return items.length > 0 ? items : false;
}

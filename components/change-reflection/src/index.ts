import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { inForkedContinuation, registerForkedContinuation } from "../../shared/src/forked-continuation.js";

export const CHANGE_REFLECTION_MESSAGE_TYPE = "change-reflection";

const MUTATION_TOOLS = new Set(["edit", "write"]);
const EXECUTION_TOOLS = new Set(["bash", "pi_exec", "agent", "get_subagent_result"]);
const PROSE_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".txt", ".rst", ".adoc"]);

export function isProsePath(path: string): boolean {
	return PROSE_EXTENSIONS.has(extname(path).toLowerCase());
}

function displayPath(cwd: string, path: string): string {
	const absolute = resolve(cwd, path);
	const local = relative(cwd, absolute);
	return local && !local.startsWith("..") && !isAbsolute(local) ? local : absolute;
}

function pathList(paths: readonly string[]): string {
	return paths.map((path) => `\`${path}\``).join(", ");
}

function describeRun(toolName: string, input: Record<string, unknown>, isError: boolean): string {
	const label = toolName === "bash" && typeof input.command === "string" ? input.command.split("\n")[0] : toolName;
	const status = isError ? " (failed)" : input.run_in_background === true ? " (started in background)" : "";
	return `\`${label}\`${status}`;
}

/** What ran after each code path's last change, so claims can be checked against it. */
function runsAfterChanges(code: readonly string[], runsAfter: ReadonlyMap<string, readonly string[]>): string {
	const groups = new Map<string, string[]>();
	for (const path of code) {
		const runs = (runsAfter.get(path) ?? []).join(", ");
		groups.set(runs, [...(groups.get(runs) ?? []), path]);
	}
	const lines = [...groups].map(([runs, paths]) =>
		runs
			? `After your last change to ${pathList(paths)}, these ran: ${runs}.`
			: `Nothing ran after your last change to ${pathList(paths)}.`,
	);
	return [...lines, "Claim only what these results check; run what is missing or say what stays unverified."].join(
		"\n",
	);
}

export function reflectionPrompt(paths: readonly string[], runsAfter: ReadonlyMap<string, readonly string[]>): string {
	const prose = paths.filter(isProsePath);
	const code = paths.filter((path) => !isProsePath(path));
	const lenses: string[] = [];
	if (code.length > 0)
		lenses.push(
			`Review your changes in ${pathList(code)}. Is there a simpler way to preserve the required behavior and fit the surrounding code?`,
			runsAfterChanges(code, runsAfter),
		);
	if (prose.length > 0)
		lenses.push(
			`Read your changes in ${pathList(prose)} as their intended reader. Can that reader understand the purpose, terms, and next steps without this conversation?`,
		);
	return [
		...lenses,
		"Make a clear improvement if one exists and revalidate anything it affects; otherwise keep the result. Stay within the requested scope.",
	].join("\n\n");
}

export default function registerChangeReflection(pi: ExtensionAPI): void {
	const reflect = registerForkedContinuation(pi, CHANGE_REFLECTION_MESSAGE_TYPE, "Change reflection");
	// Changed paths in first-change order, each with what ran after its last change.
	const changed = new Map<string, string[]>();
	let completed = false;

	pi.on("session_start", () => changed.clear());

	pi.on("tool_result", (event, ctx) => {
		if (inForkedContinuation()) return;
		if (EXECUTION_TOOLS.has(event.toolName)) {
			const run = describeRun(event.toolName, event.input, event.isError);
			for (const runs of changed.values()) if (!runs.includes(run)) runs.push(run);
			return;
		}
		if (event.isError || !MUTATION_TOOLS.has(event.toolName)) return;
		const path = event.input.path;
		if (typeof path === "string" && path.length > 0) changed.set(displayPath(ctx.cwd, path), []);
	});

	pi.on("agent_before_settle", (event) => {
		completed = event.outcome === "completed";
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (completed && changed.size > 0) reflect(ctx, reflectionPrompt([...changed.keys()], changed));
		changed.clear();
	});
}

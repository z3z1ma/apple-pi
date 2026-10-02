import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI, SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";

export const CHANGE_REFLECTION_MESSAGE_TYPE = "change-reflection";

const MUTATION_TOOLS = new Set(["edit", "write"]);
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

export function reflectionPrompt(paths: readonly string[]): string {
	const prose = paths.filter(isProsePath);
	const code = paths.filter((path) => !isProsePath(path));
	const lenses: string[] = [];
	if (code.length > 0)
		lenses.push(
			`Review your changes in ${pathList(code)}. Is there a simpler way to preserve the required behavior and fit the surrounding code?`,
		);
	if (prose.length > 0)
		lenses.push(
			`Read your changes in ${pathList(prose)} as their intended reader. Can that reader understand the purpose, terms, and next steps without this conversation?`,
		);
	return [
		...lenses,
		"Make a clear improvement if one exists and revalidate anything it affects; otherwise keep the result. Stay within the requested scope, then finish.",
	].join("\n\n");
}

export default function registerChangeReflection(pi: ExtensionAPI): void {
	const changed = new Set<string>();
	let reflecting = false;

	const reset = () => {
		changed.clear();
		reflecting = false;
	};

	pi.on("session_start", reset);

	pi.on("tool_result", (event, ctx) => {
		if (event.isError || !MUTATION_TOOLS.has(event.toolName)) return;
		const path = event.input.path;
		if (typeof path === "string" && path.length > 0) changed.add(displayPath(ctx.cwd, path));
	});

	// One reflection per settled run: edits made while reflecting do not start another.
	pi.on("agent_before_settle", (event) => {
		if (reflecting || event.outcome !== "completed" || changed.size === 0) {
			reset();
			return;
		}
		const paths = [...changed];
		changed.clear();
		reflecting = true;
		const entry: SessionBoundaryDraft = {
			type: "custom_message",
			customType: CHANGE_REFLECTION_MESSAGE_TYPE,
			content: reflectionPrompt(paths),
			display: true,
			details: { paths },
		};
		return { entries: [entry], continue: true };
	});
}

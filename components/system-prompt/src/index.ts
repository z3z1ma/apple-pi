import {
	type ExtensionAPI,
	formatSkillsForPrompt,
	getDocsPath,
	getReadmePath,
	type NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import { INTERN_MODEL, OPERATING_MODEL } from "./preamble.js";
import { toolboxSection } from "./toolbox.js";

export const SECTION_ORDER = [
	"toolbox",
	"pi-exec-peers",
	"role-catalog",
	"pair-protocol",
	"shell-output",
	"docs",
	"skills",
	"project_context",
	"project-learnings",
	"repo-rules",
	"ledger-workbench",
	"wiki-workbench",
	"org",
	"manager",
	"role",
	"specialization",
	"self",
];

function docsSection(): string {
	return `Pi's own documentation is at ${getReadmePath()} and ${getDocsPath()}. Read it only when asked about pi itself (extensions, skills, themes, the SDK), and read each file whole.`;
}

function projectContext(files: NormalizedBuildSystemPromptOptions["contextFiles"]): string | undefined {
	if (!files.length) return undefined;
	return [
		"Project-specific instructions and guidelines:",
		...files.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`),
	].join("\n\n");
}

function skillsSection(options: NormalizedBuildSystemPromptOptions, declared: string[]): string | undefined {
	const readers = ["read", "bash"];
	const reader =
		readers.find((tool) => declared.includes(tool)) ??
		(readers.some((tool) => options.selectedTools.includes(tool)) ? "indirect" : undefined);
	if (!reader || !options.skills.length) return undefined;
	return formatSkillsForPrompt(options.skills, reader as "read" | "bash" | "indirect").trim() || undefined;
}

export const INTERN_FLAG = "intern";

export function composeSystemPrompt(
	options: NormalizedBuildSystemPromptOptions,
	preamble = OPERATING_MODEL,
	docs = true,
): void {
	const declared = options.selectedTools.filter((name) => !options.hiddenTools.includes(name));
	const owned: Record<string, string | undefined> = options.customPrompt
		? {}
		: {
				toolbox: toolboxSection(declared, options.toolSnippets, options.toolGuidelines, options.promptGuidelines),
				docs: docs ? docsSection() : undefined,
			};
	owned.skills = skillsSection(options, declared);
	owned.project_context = projectContext(options.contextFiles);
	const all: Record<string, string | undefined> = { ...owned, ...options.sections };
	const ordered: Record<string, string> = {};
	for (const name of [...SECTION_ORDER, ...Object.keys(all)]) {
		const content = all[name];
		if (content && !(name in ordered)) ordered[name] = content;
	}
	options.customPrompt ??= preamble;
	options.skills = [];
	options.contextFiles = [];
	options.sections = ordered;
}

export function systemPromptComposer(preamble: (pi: ExtensionAPI) => string, docs = true) {
	return (pi: ExtensionAPI): void => {
		pi.on("before_agent_start", (event) => {
			event.systemPromptOptions.selectedTools = pi.getActiveTools();
			composeSystemPrompt(event.systemPromptOptions, preamble(pi), docs);
		});
	};
}

export default function installSystemPrompt(pi: ExtensionAPI): void {
	pi.registerFlag(INTERN_FLAG, {
		type: "boolean",
		description: "This session is a one-shot intern answering another agent's question",
	});
	systemPromptComposer((api) => (api.getFlag(INTERN_FLAG) ? INTERN_MODEL : OPERATING_MODEL))(pi);
}

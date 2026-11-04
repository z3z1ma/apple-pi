import {
	type ExtensionAPI,
	formatSkillsForPrompt,
	getDocsPath,
	getExamplesPath,
	getReadmePath,
	type NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";

export const PREAMBLE =
	"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

export const SECTION_ORDER = [
	"tools",
	"rules",
	"docs",
	"pi-exec-peers",
	"role-catalog",
	"pair-protocol",
	"shell-output",
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

function toolsSection(declared: string[], snippets: Record<string, string>): string {
	const listed = declared.filter((name) => snippets[name]);
	const tools = listed.length ? listed.map((name) => `- ${name}: ${snippets[name]}`).join("\n") : "(none)";
	return `${tools}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`;
}

function rulesSection(
	declared: string[],
	toolGuidelines: Record<string, string[]>,
	promptGuidelines: string[],
): string {
	const rules: string[] = [];
	const seen = new Set<string>();
	const add = (rule: string) => {
		const text = rule.trim();
		if (!text || seen.has(text)) return;
		seen.add(text);
		rules.push(text);
	};
	const has = (name: string) => declared.includes(name);
	if ((has("bash") || has("powershell")) && !has("grep") && !has("find") && !has("ls")) {
		if (has("bash") && has("powershell"))
			add("Use bash or PowerShell for file operations like listing, searching, and finding files");
		else if (has("powershell")) add("Use PowerShell for file operations like listing, searching, and finding files");
		else add("Use bash for file operations like ls, rg, find");
	}
	for (const name of declared) for (const rule of toolGuidelines[name] ?? []) add(rule);
	for (const rule of promptGuidelines) add(rule);
	add("Be concise in your responses");
	add("Show file paths clearly when working with files");
	return rules.map((rule) => `- ${rule}`).join("\n");
}

function docsSection(): string {
	return `Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${getReadmePath()}
- Additional docs: ${getDocsPath()}
- Examples: ${getExamplesPath()} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;
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

export function composeSystemPrompt(options: NormalizedBuildSystemPromptOptions): void {
	const declared = options.selectedTools.filter((name) => !options.hiddenTools.includes(name));
	const owned: Record<string, string | undefined> = options.customPrompt
		? {}
		: {
				tools: toolsSection(declared, options.toolSnippets),
				rules: rulesSection(declared, options.toolGuidelines, options.promptGuidelines),
				docs: docsSection(),
			};
	owned.skills = skillsSection(options, declared);
	owned.project_context = projectContext(options.contextFiles);
	const contributed = { ...options.sections };
	const all: Record<string, string | undefined> = { ...owned, ...contributed };
	const ordered: Record<string, string> = {};
	for (const name of [...SECTION_ORDER, ...Object.keys(all)]) {
		const content = all[name];
		if (content && !(name in ordered)) ordered[name] = content;
	}
	options.customPrompt ??= PREAMBLE;
	options.skills = [];
	options.contextFiles = [];
	options.sections = ordered;
}

export default function installSystemPrompt(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.selectedTools = pi.getActiveTools();
		composeSystemPrompt(event.systemPromptOptions);
	});
}

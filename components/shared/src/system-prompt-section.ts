import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

/**
 * Add a named section to this run's structured system prompt. Pi renders it as `<name>…</name>`.
 * An append-mode subagent inherits its parent's rendered prompt as its custom preamble; a section
 * already rendered there is not repeated.
 */
export function setSystemPromptSection(
	options: NormalizedBuildSystemPromptOptions,
	name: string,
	content: string,
): void {
	if (options.customPrompt?.includes(`<${name}>\n`)) return;
	options.sections[name] = content;
}

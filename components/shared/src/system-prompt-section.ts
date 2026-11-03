import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

export function setSystemPromptSection(
	options: NormalizedBuildSystemPromptOptions,
	name: string,
	content: string,
): void {
	if (options.customPrompt?.includes(`<${name}>\n`)) return;
	options.sections[name] = content;
}

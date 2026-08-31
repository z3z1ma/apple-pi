export const WIKI_SYSTEM_PROMPT_TAG = "wiki-workbench";

export const WIKI_SYSTEM_PROMPT = `<wiki-workbench>
# The wiki

The wiki is a project-local knowledge workbench under \`.wiki/\`. It accumulates reusable LLM-oriented context across tasks. \`.ledger/\` owns bounded execution work, while repository documentation and tests remain authoritative for product behavior. The repository owner decides whether the wiki is ignored, committed, or shared.

A usual wiki starts with \`README.md\`, \`INDEX.md\`, \`LOG.md\`, \`raw/\`, and \`pages/\`, but its organization may evolve through local conventions in \`.wiki/README.md\`. Markdown pages link with Obsidian syntax such as \`[[slug]]\` and \`[[slug#Heading|label]]\`. A page's slug is its filename stem, matched case-insensitively, and must be unique across the entire wiki regardless of nesting.

Before wiki work, read its README and index, then use \`wiki_references\` when inbound, outbound, or nearby graph context matters. Use ordinary file tools for writes. Keep navigation accurate, append the log only after a coherent knowledge mutation, and run \`wiki_lint\` after link or structural changes. When the \`llm-wiki\` skill is available, load it for initialization, ingestion, querying, maintenance, provenance, and mutation discipline.
</wiki-workbench>`;

export function appendWikiSystemPrompt(systemPrompt: string): string {
	if (systemPrompt.includes(`<${WIKI_SYSTEM_PROMPT_TAG}>`)) return systemPrompt;
	const base = systemPrompt.trim();
	return base ? `${base}\n\n${WIKI_SYSTEM_PROMPT}` : WIKI_SYSTEM_PROMPT;
}

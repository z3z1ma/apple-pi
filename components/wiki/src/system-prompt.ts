export const WIKI_SYSTEM_PROMPT_TAG = "wiki-workbench";

export const WIKI_SYSTEM_PROMPT = `\`.wiki/\` is this project's knowledge workbench: reusable context that outlives single tasks. \`.ledger/\` owns bounded task work, and repository documentation and tests stay authoritative for product behavior.

Before wiki work, read \`.wiki/README.md\` for local conventions and \`.wiki/INDEX.md\` for navigation. Pages link with Obsidian syntax such as \`[[slug]]\` and \`[[slug#Heading|label]]\`; a slug is the filename stem, matched case-insensitively and unique across the wiki. Use \`wiki_references\` for nearby graph context, ordinary file tools for writes, and \`wiki_lint\` after link or structural changes. Load the \`llm-wiki\` skill for ingestion, maintenance, and mutation discipline.`;

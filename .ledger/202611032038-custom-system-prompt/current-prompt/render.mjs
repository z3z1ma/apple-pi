import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const payload = JSON.parse(readFileSync(join(here, "capture", "payload-anthropic.json"), "utf8"));
const openai = JSON.parse(readFileSync(join(here, "capture", "payload-openai.json"), "utf8"));

const SOURCES = {
	identity: [
		"pi-ai, Anthropic provider",
		"Prepended as its own system block on Anthropic requests (`pi-ai/dist/api/anthropic-messages.js`). Not sent to OpenAI.",
	],
	preamble: [
		"Pi base",
		"Pi's fixed opening line (`pi-coding-agent/dist/core/system-prompt.js`). `--system-prompt` replaces it, and then Pi also drops `tools`, `rules` and `docs`.",
	],
	tools: [
		"Pi base, from every tool",
		"One line per active tool: its name and its `promptSnippet`. Tools without a snippet are callable but not listed here.",
	],
	rules: [
		"Pi base, from every tool",
		"Pi's `buildRules`: a shell rule, then each active tool's `promptGuidelines` in tool order, then `promptGuidelines` passed in directly, then Pi's two fixed lines (concise; show file paths). Duplicates are dropped.",
	],
	docs: ["Pi base", "Where Pi's own documentation lives. Fixed text with install paths filled in."],
	project_context: [
		"Pi base, from context files",
		"Every `AGENTS.md` Pi finds: the global `~/.pi/agent/AGENTS.md`, then the repository's `AGENTS.md`.",
	],
	skills: [
		"Pi base, from skill discovery",
		"Name, description and path of every skill Pi discovered: `~/.pi/agent/skills`, `~/.agents/skills`, and the skills apple-pi ships.",
	],
	cwd: ["Pi base", "The working directory."],
	"project-learnings": [
		"apple-pi: notebook",
		"The repository's `.pi/LEARNINGS.md` (`components/notebook/src/hooks/project-learnings.ts`).",
	],
	"repo-rules": [
		"apple-pi: repo rules",
		"How this repository's `.pi/rules/` works; a short offer to set it up in repositories without one (`components/repo-rules/src/index.ts`).",
	],
	"pi-exec-peers": [
		"apple-pi: pi_exec",
		"How programs use peers. Only for people who manage (`components/pi-exec/src/index.ts`).",
	],
	"ledger-workbench": [
		"apple-pi: ledger",
		"The ledger contract (`components/shared/src/ledger-system-prompt.ts`, installed by `extensions/ledger.ts`).",
	],
	"wiki-workbench": ["apple-pi: wiki", "The wiki contract (`components/wiki/src/system-prompt.ts`)."],
	self: [
		"apple-pi: organization",
		"The person's own story, practice, commitments and colleagues, kept with `update_self` (`components/organization/src/self.ts`). A new person has none yet.",
	],
	org: [
		"apple-pi: organization",
		"Who this session is, its id, its manager, and how the organization works: directory, mail, channels, tasks, manager tools (`components/organization/src/install.ts`, `charters.ts`).",
	],
	"role-catalog": [
		"apple-pi: organization",
		"The roles a manager can hire (`roles/`, then `~/.pi/agent/roles/`, then `<cwd>/.pi/roles/`). Only for people who manage.",
	],
	mcp_servers: [
		"Pi base, native MCP",
		"The MCP servers whose tools are not declared up front, to load with `tool_search`.",
	],
};

const CONDITIONAL = [
	[
		"role",
		"apple-pi: organization",
		"The role's charter, for a person hired into a role (`components/organization/src/session-role.ts`).",
	],
	["manager", "apple-pi: organization", "The management charter, for a person whose role manages."],
	["specialization", "apple-pi: organization", "A focus within the role, when the person was hired with one."],
	["pair-protocol", "apple-pi: pair programmer", "How to work with the pair, while the pair programmer is on."],
	["shell-output", "apple-pi: RTK", "How RTK compresses command output, when `RTK_ENABLED=1`."],
	["addendum", "Pi base", "Text from `--append-system-prompt`."],
];

const tokens = (text) => Math.round(text.length / 4);

function readable(text) {
	let fenced = false;
	return text
		.split("\n")
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) {
				fenced = !fenced;
				return line;
			}
			if (fenced || !line.trim()) return line;
			const heading = /^(#{1,6}) (.*)$/.exec(line);
			if (heading) return `${"#".repeat(Math.min(6, heading[1].length + 2))} ${heading[2]}`;
			return `${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}  `;
		})
		.join("\n");
}

function sections(text) {
	const found = [];
	const opening = /^<([a-z_-]+)(?:\s[^>]*)?>$/gm;
	for (let match = opening.exec(text); match; match = opening.exec(text)) {
		const close = `</${match[1]}>`;
		const end = text.indexOf(`\n${close}`, match.index);
		if (end < 0 || found.some((section) => match.index < section.end)) continue;
		found.push({ tag: match[1], start: match.index, end: end + close.length + 1 });
	}
	const preamble = text.slice(0, found[0]?.start ?? text.length).trim();
	return [
		{ tag: "preamble", body: preamble },
		...found.map((section) => ({
			tag: section.tag,
			body: text.slice(section.start + section.tag.length + 3, section.end - section.tag.length - 4),
		})),
	];
}

const identity = payload.system[0].text;
const main = payload.system[1].text;
const parts = [{ tag: "identity", body: identity }, ...sections(main)];
const full = `${identity}\n\n${main}`;
const toolText = JSON.stringify(payload.tools);

writeFileSync(join(here, "system-prompt.txt"), `${full}\n`);

const table = parts
	.map((part, index) => {
		const [owner] = SOURCES[part.tag] ?? ["unknown"];
		return `| ${index + 1} | [\`${part.tag}\`](system-prompt.md#${part.tag}) | ${owner} | ${part.body.length.toLocaleString("en")} | ~${tokens(part.body).toLocaleString("en")} |`;
	})
	.join("\n");

writeFileSync(
	join(here, "system-prompt.md"),
	[
		"# The system prompt, as sent",
		"",
		"Captured from a real request: a fresh, unroled root session in this repository, on `anthropic/claude-opus-5-5`, with the operator's configuration and every apple-pi extension loaded. The request was stopped before it left the machine. Each section below is its full text, in order, with what writes it. It is rendered for reading: headings inside a section are demoted two levels so they stay under it, and tags such as `<skill>` are shown as text. The exact bytes are in [system-prompt.txt](system-prompt.txt). See [README](README.md) for how this was captured and what changes from session to session.",
		"",
		...parts.flatMap((part) => {
			const [owner, what] = SOURCES[part.tag] ?? ["unknown", ""];
			return [
				`## ${part.tag}`,
				"",
				`**Written by:** ${owner}. ${what}`,
				"",
				`**Size:** ${part.body.length.toLocaleString("en")} characters, about ${tokens(part.body).toLocaleString("en")} tokens.`,
				"",
				part.tag === "identity" || part.tag === "preamble"
					? ""
					: `In the request this text sits between \`<${part.tag}>\` and \`</${part.tag}>\`.\n`,
				"---",
				"",
				readable(part.body),
				"",
				"---",
				"",
			];
		}),
	].join("\n"),
);

const toolDocs = payload.tools
	.filter((tool) => tool.name !== "__pi_deferred_placeholder__")
	.map((tool) =>
		[
			`## ${tool.name}`,
			"",
			readable(tool.description ?? ""),
			"",
			"<details><summary>Parameters</summary>",
			"",
			"```json",
			JSON.stringify(tool.input_schema, null, 2),
			"```",
			"",
			"</details>",
			"",
		].join("\n"),
	);
writeFileSync(
	join(here, "tools.md"),
	[
		"# The tool definitions, as sent",
		"",
		`Every tool definition in the same request: ${toolDocs.length} tools, ${toolText.length.toLocaleString("en")} characters of JSON, about ${tokens(toolText).toLocaleString("en")} tokens. The model reads each description and parameter schema as prompt text, so these count as much as the system prompt. On Anthropic, Pi renames the four core tools to Claude Code's names (\`Read\`, \`Bash\`, \`Edit\`, \`Write\`) and \`task\` to \`Task\`; OpenAI keeps the lower-case names. MCP tools are not here: they are deferred, and \`tool_search\` loads them.`,
		"",
		`Index: ${payload.tools
			.filter((tool) => tool.name !== "__pi_deferred_placeholder__")
			.map((tool) => `[\`${tool.name}\`](#${tool.name.toLowerCase()})`)
			.join(" · ")}`,
		"",
		...toolDocs,
	].join("\n"),
);

const openaiText = openai.input.find((item) => item.role === "developer" && typeof item.content === "string").content;
const openaiTools = openai.input.find((item) => item.type === "additional_tools").tools.length;

writeFileSync(
	join(here, "README.md"),
	[
		"# The current system prompt",
		"",
		"What the model receives today in a root session of this repository, captured from a real request rather than reconstructed from source.",
		"",
		"- [system-prompt.md](system-prompt.md): the full system prompt, section by section, each with what writes it.",
		"- [tools.md](tools.md): every tool definition sent with it.",
		"- [system-prompt.txt](system-prompt.txt): the exact text, for diffing.",
		"",
		"## Size",
		"",
		`| | Characters | About |`,
		`|---|---:|---:|`,
		`| System prompt | ${full.length.toLocaleString("en")} | ${tokens(full).toLocaleString("en")} tokens |`,
		`| Tool definitions (${payload.tools.length - 1} tools) | ${toolText.length.toLocaleString("en")} | ${tokens(toolText).toLocaleString("en")} tokens |`,
		`| Together | ${(full.length + toolText.length).toLocaleString("en")} | ${tokens(full + toolText).toLocaleString("en")} tokens |`,
		"",
		"Token counts are characters ÷ 4, an estimate.",
		"",
		"## How it is put together",
		"",
		"Pi builds the prompt from ordered, named sections (`buildSystemPromptSections` in `pi-coding-agent/dist/core/system-prompt.js`). It writes the base sections itself. Then, on every run, each extension's `before_agent_start` hook can add or replace a section in `systemPromptOptions.sections`. Pi wraps every section except the preamble in `<name>…</name>`. The transcript records the sections, and when one changes between runs Pi records only the change (`diffSystemPromptSections`). The provider still receives the whole prompt on every request, so a section whose text stays stable keeps the request prefix cacheable.",
		"",
		"```mermaid",
		"flowchart LR",
		'  A["Pi base<br/>preamble, tools, rules,<br/>docs, project_context,<br/>skills, cwd"] --> C["sections"]',
		'  B["apple-pi hooks<br/>(before_agent_start)"] --> C',
		'  M["Pi MCP<br/>mcp_servers"] --> C',
		'  C --> P["provider request"]',
		'  I["Anthropic identity line"] --> P',
		'  T["tool definitions"] --> P',
		"```",
		"",
		"| # | Section | Written by | Characters | Tokens |",
		"|---:|---|---|---:|---:|",
		table,
		"",
		"Pi offers three ways to own the prompt:",
		"",
		"- **Replace the preamble:** `--system-prompt` or `customPrompt`. Pi then drops its own `tools`, `rules` and `docs`, and keeps `project_context`, `skills`, `cwd` and every extension section.",
		"- **Replace one section:** an extension that sets a section of the same name in `before_agent_start` replaces it.",
		"- **Replace everything:** `forceSystemPrompt`, or a `systemPrompt` returned from `before_agent_start`, sends that text alone.",
		"",
		"## Sections this capture does not show",
		"",
		"A fresh unroled root session does not get these; other sessions do.",
		"",
		"| Section | Written by | When |",
		"|---|---|---|",
		...CONDITIONAL.map(([tag, owner, when]) => `| \`${tag}\` | ${owner} | ${when} |`),
		"",
		"## What changes from session to session",
		"",
		"- **`org`** names the person (here a temporary one, in an empty organization made for the capture) and carries its id, its manager and its team channel. A person with a manager gets the reporting text; a root gets the manager tools text.",
		"- **`self`** is empty for a new person. A long-lived person's self runs to several thousand words.",
		"- **`pi-exec-peers` and `role-catalog`** appear only for people who manage: roles that manage, and unroled organization roots.",
		"- **`project_context`, `project-learnings`, `repo-rules` and `cwd`** follow the repository. Outside this one, the repository's `AGENTS.md`, `.pi/LEARNINGS.md` and `.pi/rules/` are different or absent.",
		"- **`mcp_servers`** lists the MCP servers that are connected. Their descriptions arrive while the servers connect, so an early request can list a server without its description.",
		"",
		"## Provider differences",
		"",
		`The same session on \`openai/gpt-6.1-sol\` gets the same sections (${openaiText.length.toLocaleString("en")} characters), with these differences:`,
		"",
		"- no Anthropic identity line;",
		"- the core tools keep their lower-case names (`read`, `bash`, `edit`, `write`, `task`);",
		`- the tool definitions travel in the input as an \`additional_tools\` item (${openaiTools} tools) rather than in a \`tools\` field.`,
		"",
		"## Not in the system prompt",
		"",
		"These reach the model as messages during a session, not as part of the system prompt:",
		"",
		"- mail, channel posts and task notices from the organization;",
		"- the pair programmer's findings and the notebook's learnings list (after each compaction);",
		"- reflection prompts (change reflection, learning reflection, self reflection);",
		"- `.context/<path>.md` files, appended to `read` results;",
		"- skill files, read on demand;",
		"- repo-rule and context-gate refusals, as tool results.",
		"",
		"## How to capture again",
		"",
		"```sh",
		"node .ledger/202611032038-custom-system-prompt/current-prompt/capture.mjs",
		"node .ledger/202611032038-custom-system-prompt/current-prompt/render.mjs",
		"```",
		"",
		"`capture.mjs` runs the installed `pi` in RPC mode in this repository with a temporary agent directory. That directory links to the real configuration (settings, `AGENTS.md`, skills, model profiles, roles, MCP) but has its own empty `state/` and `sessions/`. The capture session therefore runs in its own runtime and database and does not join the operator's organization. A one-line extension writes the `before_provider_request` payload to disk and throws, so no request is sent and no model is billed. The script stops the runtime it started and removes the temporary directory. `render.mjs` turns the two payloads in `capture/` into these files.",
		"",
	].join("\n"),
);
console.log(`system prompt ${full.length} chars, tools ${toolText.length} chars, ${parts.length} sections`);

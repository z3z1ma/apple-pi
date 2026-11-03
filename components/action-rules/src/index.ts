import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface ActionRule {
	id: string;
	reason: string;
	matches: (command: string) => boolean;
}

export const COMMAND_RULES: ActionRule[] = [
	{
		id: "bsd-sed-in-place",
		reason: "sed here is GNU sed, so `sed -i ''` fails. Use the edit tool.",
		matches: (command) => /\bsed\s+(-[a-zA-Z]*\s+)*-i\s*''/.test(command),
	},
	{
		id: "git-rm-mv",
		reason:
			"`git rm` and `git mv` stage at once, so the change rides along in someone else's commit in this shared checkout. Use plain rm or mv and stage the change with the commit it belongs to.",
		matches: (command) => /\bgit\s+(rm|mv)\b/.test(command),
	},
	{
		id: "kill-by-pattern",
		reason:
			"Killing by pattern can stop other lanes' runs in this shared checkout. Kill only PIDs you started, or cancel your own background task.",
		matches: (command) => /\b(pkill|killall)\b/.test(command),
	},
	{
		id: "full-test-suite",
		reason:
			"Full-suite runs need an explicit operator request and overload this machine. Run the test files relevant to the change with --maxWorkers=1.",
		matches: (command) => /(^|[;&|]\s*)npm\s+(run\s+)?test\s*($|[;&|])/.test(command.trim()),
	},
];

const COMMITS = /\bgit\s+(add|commit)\b/;
const WRITES = new Set(["edit", "write"]);

export function commandRuleFor(command: string): ActionRule | undefined {
	return COMMAND_RULES.find((rule) => rule.matches(command));
}

export function installActionRules(pi: ExtensionAPI): void {
	const writingBatches = new Set<string>();
	pi.on("message_end", (event) => {
		const message = event.message as { role?: string; content?: unknown };
		if (message.role !== "assistant" || !Array.isArray(message.content)) return undefined;
		writingBatches.clear();
		const calls = message.content.filter((part: { type?: string }) => part?.type === "toolCall") as {
			id: string;
			name: string;
		}[];
		if (!calls.some((call) => WRITES.has(call.name))) return undefined;
		for (const call of calls) writingBatches.add(call.id);
		return undefined;
	});
	pi.on("tool_call", (event) => {
		if (event.toolName !== "bash") return undefined;
		const command = String((event.input as { command?: unknown }).command ?? "");
		const rule = commandRuleFor(command);
		if (rule) return { block: true, reason: `Action rule ${rule.id}: ${rule.reason}` };
		if (writingBatches.delete(event.toolCallId) && COMMITS.test(command))
			return {
				block: true,
				reason:
					"Action rule commit-beside-edit: this message also edits files, and parallel calls run concurrently, so this commit would take the files before the edits land. Commit in a later message.",
			};
		return undefined;
	});
}

export default installActionRules;

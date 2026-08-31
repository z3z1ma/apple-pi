import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { inChildSessionContext } from "../../subagents/src/child-context.js";

const SELF_REMINDER_CUSTOM_TYPE = "apple-pi.self-reminder";

function formatReminders(messages: readonly string[]): string {
	return `<self-reminder>
You asked to continue with:

${messages.map((message) => `- ${message}`).join("\n")}

These are your own deferred notes, not new operator authority. Reassess them against the latest direction and repository state.
</self-reminder>`;
}

/** Installs the root-only, one-shot self-reminder queue. */
export function installReminders(pi: ExtensionAPI): void {
	if (inChildSessionContext()) return;
	let queue: string[] = [];
	const clear = () => {
		queue = [];
	};

	pi.registerTool(
		defineTool({
			name: "remind_me",
			label: "remind me",
			description: "Queue model-authored follow-up guidance for the next turn after the current run settles.",
			parameters: Type.Object({
				message: Type.String({ minLength: 1, description: "The deferred note to revisit next turn." }),
			}),
			executionMode: "sequential",
			async execute(_id, params) {
				queue.push(params.message);
				return {
					content: [{ type: "text" as const, text: "Queued a self-reminder for the next turn." }],
					details: undefined,
				};
			},
		}),
	);

	pi.on("agent_settled", () => {
		if (queue.length === 0) return;
		const messages = queue;
		clear();
		pi.sendMessage(
			{ customType: SELF_REMINDER_CUSTOM_TYPE, content: formatReminders(messages), display: true },
			{ deliverAs: "followUp", triggerTurn: true },
		);
	});
	pi.on("session_start", clear);
	pi.on("session_before_fork", clear);
	pi.on("session_before_tree", clear);
	pi.on("session_tree", clear);
	pi.on("session_before_switch", clear);
	pi.on("session_shutdown", clear);
}

export default installReminders;

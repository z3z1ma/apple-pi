import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const PARENT_ESCALATION_TOOL_NAME = "escalate_to_parent";

export interface ParentEscalation {
	agentId: string;
	message: string;
}

export type ParentEscalationOutcome = "woke-waits" | "steered";
export type ParentEscalationHandler = (agentId: string, message: string) => ParentEscalationOutcome;

interface ActiveWait {
	agentId: string;
	resolve: (escalation: ParentEscalation) => void;
}

export interface ParentEscalationWait {
	promise: Promise<ParentEscalation>;
	close(): void;
}

/** Routes a direct child's escalation either into matching result waits or into the live root turn. */
export class ParentEscalationHub {
	private readonly waits = new Set<ActiveWait>();

	constructor(private readonly deliverToRoot: (escalation: ParentEscalation) => void) {}

	registerWait(agentId: string): ParentEscalationWait {
		let resolve!: (escalation: ParentEscalation) => void;
		const promise = new Promise<ParentEscalation>((settle) => {
			resolve = settle;
		});
		const wait = { agentId, resolve };
		this.waits.add(wait);
		return {
			promise,
			close: () => this.waits.delete(wait),
		};
	}

	escalate(agentId: string, message: string): ParentEscalationOutcome {
		const escalation = { agentId, message };
		const rootIsWaitingForAgent = [...this.waits].some((wait) => wait.agentId === agentId);
		if (!rootIsWaitingForAgent) {
			this.deliverToRoot(escalation);
			return "steered";
		}
		const activeWaits = [...this.waits];
		this.waits.clear();
		for (const wait of activeWaits) wait.resolve(escalation);
		return "woke-waits";
	}
}

export function createParentEscalationTool(agentId: string, escalate: ParentEscalationHandler): ToolDefinition {
	return defineTool({
		name: PARENT_ESCALATION_TOOL_NAME,
		label: "Escalate to Parent",
		description:
			"Immediately inform the root session of an urgent blocker, risk, or decision that it should know before this run completes. Continue working after calling it; this tool does not stop or complete your run.",
		promptGuidelines: [
			"Use escalate_to_parent only for an unexpected blocker, material risk, or decision the root must act on before your final result.",
			"Do not use it for routine progress updates, ordinary findings, or information that can wait for your final result.",
			"After escalating, continue all useful work that does not depend on the root's response. If no useful work remains, finish normally with a complete final result.",
		],
		parameters: Type.Object({
			message: Type.String({
				minLength: 1,
				description: "Concise, actionable context the root session needs immediately.",
			}),
		}),
		async execute(_toolCallId, params) {
			const message = params.message.trim();
			if (!message) {
				return {
					content: [{ type: "text" as const, text: "Escalation message must not be empty." }],
					isError: true,
					details: {},
				};
			}
			const outcome = escalate(agentId, message);
			return {
				content: [
					{
						type: "text" as const,
						text:
							outcome === "woke-waits"
								? "The parent was waiting and has been alerted. Continue working on anything that does not require its response."
								: "The parent has been alerted. Continue working on anything that does not require its response.",
					},
				],
				details: {},
			};
		},
	});
}

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatParentEscalation(escalation: ParentEscalation): string {
	return [
		"<subagent-escalation>",
		`<agent-id>${escapeXml(escalation.agentId)}</agent-id>`,
		`<message>${escapeXml(escalation.message)}</message>`,
		"<status>The subagent is still running. React to the escalation without treating it as the final result.</status>",
		"</subagent-escalation>",
	].join("\n");
}

export function formatInterruptedResultWait(waitingAgentId: string, escalation: ParentEscalation): string {
	if (waitingAgentId === escalation.agentId) return formatParentEscalation(escalation);
	return `Wait for agent ${waitingAgentId} was interrupted by an escalation from agent ${escalation.agentId}. Both agents are still running; the matching tool result contains the escalation message.`;
}

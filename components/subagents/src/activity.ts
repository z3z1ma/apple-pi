import type { HarnessBoundedActivity } from "./service.js";
import type { AgentActivity } from "./ui/agent-widget.js";
import { addUsage } from "./usage.js";

const ACTIVITY_UPDATE_DEBOUNCE_MS = 250;

const TOOL_LABELS: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing",
	open_review: "opening reviews",
	report: "reporting",
	submit_meta_review: "verifying",
};

export function sanitizeHarnessActivity(input: {
	toolName?: string;
	turnCount: number;
	toolCount: number;
	activeToolCount: number;
}): HarnessBoundedActivity {
	const toolName = input.toolName && TOOL_LABELS[input.toolName] ? input.toolName : undefined;
	const usingTools = input.activeToolCount > 0;
	const label = usingTools ? (toolName ? TOOL_LABELS[toolName] : "using tools") : "thinking";
	return {
		phase: usingTools ? "tool" : "thinking",
		...(toolName && { toolName }),
		turnCount: Math.max(0, input.turnCount),
		toolCount: Math.max(0, input.toolCount),
		label: `${label}…`,
	};
}

/** Tracks one agent's live tool, text, session, turn, and usage state for UI consumers. */
export function createActivityTracker(
	maxTurns?: number,
	onChange?: () => void,
	onHarnessActivity?: (activity: HarnessBoundedActivity) => void,
) {
	let textUpdateTimer: ReturnType<typeof setTimeout> | undefined;
	const notifyTextChange = () => {
		if (!onChange || textUpdateTimer) return;
		textUpdateTimer = setTimeout(() => {
			textUpdateTimer = undefined;
			onChange();
		}, ACTIVITY_UPDATE_DEBOUNCE_MS);
		textUpdateTimer.unref?.();
	};
	const state: AgentActivity = {
		activeTools: new Map(),
		toolUses: 0,
		turnCount: 1,
		maxTurns,
		responseText: "",
		session: undefined,
		lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
	};
	const emitHarness = (toolName?: string) => {
		try {
			onHarnessActivity?.(
				sanitizeHarnessActivity({
					toolName: toolName ?? [...state.activeTools.values()].at(-1),
					turnCount: state.turnCount,
					toolCount: state.toolUses,
					activeToolCount: state.activeTools.size,
				}),
			);
		} catch {
			// Harness projection faults must not abort the managed child.
		}
	};
	return {
		state,
		callbacks: {
			onToolActivity: (activity: { type: "start" | "end"; toolName: string }) => {
				if (activity.type === "start")
					state.activeTools.set(`${activity.toolName}:${Date.now()}:${state.activeTools.size}`, activity.toolName);
				else {
					for (const [key, name] of state.activeTools) {
						if (name === activity.toolName) {
							state.activeTools.delete(key);
							break;
						}
					}
					state.toolUses++;
				}
				onChange?.();
				emitHarness(activity.toolName);
			},
			onTextDelta: (_delta: string, fullText: string) => {
				state.responseText = fullText;
				notifyTextChange();
			},
			onTurnEnd: (turnCount: number) => {
				state.turnCount = turnCount;
				onChange?.();
				emitHarness();
			},
			onSessionCreated: (session: any) => {
				state.session = session;
				onChange?.();
			},
			onAssistantUsage: (usage: { input: number; output: number; cacheWrite: number }) => {
				addUsage(state.lifetimeUsage, usage);
				onChange?.();
			},
		},
	};
}

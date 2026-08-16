import { addUsage } from "./usage.js";
import type { AgentActivity } from "./ui/agent-widget.js";

const ACTIVITY_UPDATE_DEBOUNCE_MS = 250;

/** Tracks one agent's live tool, text, session, turn, and usage state for UI consumers. */
export function createActivityTracker(maxTurns?: number, onChange?: () => void) {
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
			},
			onTextDelta: (_delta: string, fullText: string) => {
				state.responseText = fullText;
				notifyTextChange();
			},
			onTurnEnd: (turnCount: number) => {
				state.turnCount = turnCount;
				onChange?.();
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

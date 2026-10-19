// Which conversation is open, and what the panel needs from outside React: the backend's conversation API and the
// theme (for portraits and place names). `main.tsx` connects them and opens the panel when the world or the side panel
// asks to talk to a character. Each change replaces the state object, as useSyncExternalStore needs.
//
// It also keeps what outlives one opening of the panel: each character's unsent draft, and the instructions sent to it
// with the receipt stages they reached.
import type { AgentWorldApi, Character, Instruction, ReceiptStage } from "../../../src/world.js";
import type { Theme } from "../../theme.js";

/** Reading the conversation is required; acting and live replies are there once the backend offers them. */
export type ConversationApi = Pick<AgentWorldApi, "conversation" | "markSeen"> &
	Partial<Pick<AgentWorldApi, "instruct" | "onReceipt" | "watchReplies" | "onReply">>;

export interface PanelState {
	/** The character talked to, as it was when the panel opened; the panel follows its live facts from the store. */
	character?: Character;
	/** Counts each opening, so talking to the same character again starts afresh. */
	opening: number;
	api?: ConversationApi;
	theme?: Theme;
}

/** One instruction sent from the panel, with the receipt stages it has reached. */
export interface Sent {
	commandId: string;
	characterId: string;
	kind: Instruction["kind"];
	/** The words sent, if any. */
	text?: string;
	/** The questionnaire an answer is for. */
	questionnaire?: string;
	at: number;
	stages: ReceiptStage[];
	reason?: string;
}

/** Instructions kept per character for the panel to show. */
const SENT_KEPT = 3;

let state: PanelState = { opening: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<PanelState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};

const drafts = new Map<string, string>();
/** A questionnaire form's choices so far, per question, by the questionnaire's id. */
export interface FormAnswer {
	chosen: string[];
	own: boolean;
	words: string;
}
const formDrafts = new Map<string, FormAnswer[]>();
let sent: Sent[] = [];
const sentListeners = new Set<() => void>();
const setSent = (next: Sent[]) => {
	sent = next;
	for (const listener of sentListeners) listener();
};
let stopReceipts: (() => void) | undefined;
// What Escape closes first: a confirmation or form inside the panel, before the panel itself.
const escapes: (() => void)[] = [];
let commandCount = 0;

/** Record a stage for a sent instruction, once and in order. */
function reached(commandId: string, stage: ReceiptStage, reason?: string) {
	const index = sent.findIndex((s) => s.commandId === commandId);
	if (index < 0) return;
	const was = sent[index];
	if (was.stages.includes(stage) || was.stages.includes("failed") || was.stages.includes("applied")) return;
	const next = [...sent];
	next[index] = { ...was, stages: [...was.stages, stage], ...(reason ? { reason } : {}) };
	setSent(next);
}

export const conversationPanel = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: ConversationApi, theme: Theme) {
		stopReceipts?.();
		stopReceipts = api.onReceipt?.((receipt) => reached(receipt.commandId, receipt.stage, receipt.reason));
		update({ api, theme });
	},
	open(character: Character) {
		update({ character, opening: state.opening + 1 });
	},
	close() {
		if (state.character) update({ character: undefined });
	},
	/** While `handler` is registered, Escape calls it instead of closing the panel; returns a function that stops. */
	onEscape(handler: () => void): () => void {
		escapes.push(handler);
		return () => {
			const index = escapes.lastIndexOf(handler);
			if (index >= 0) escapes.splice(index, 1);
		};
	},
	/** Escape: the innermost confirmation, or else the panel. */
	escape() {
		const top = escapes.at(-1);
		if (top) top();
		else conversationPanel.close();
	},
	/** What the operator had typed to a character and not sent; kept while the app runs. */
	draft: (characterId: string) => drafts.get(characterId) ?? "",
	setDraft(characterId: string, text: string) {
		if (text) drafts.set(characterId, text);
		else drafts.delete(characterId);
	},
	/** The choices made so far in a questionnaire's form; kept while the app runs, like a draft. */
	formDraft: (questionnaire: string) => formDrafts.get(questionnaire),
	setFormDraft(questionnaire: string, answers: FormAnswer[]) {
		formDrafts.set(questionnaire, answers);
	},
	/** Every instruction sent and kept, oldest first; a new array after each change. */
	sent: () => sent,
	subscribeSent(listener: () => void): () => void {
		sentListeners.add(listener);
		return () => sentListeners.delete(listener);
	},
	/** Send an instruction to a character; its stages appear in `sent` as the receipts arrive. */
	instruct(character: Character, instruction: Instruction): Promise<boolean> {
		const api = state.api;
		const commandId = `agent-world-${Date.now().toString(36)}-${(++commandCount).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const text = "text" in instruction ? instruction.text : undefined;
		const questionnaire = instruction.kind === "answer" ? instruction.questionnaire : undefined;
		const mine = sent.filter((s) => s.characterId === character.id).slice(-(SENT_KEPT - 1));
		const others = sent.filter((s) => s.characterId !== character.id);
		setSent([
			...others,
			...mine,
			{ commandId, characterId: character.id, kind: instruction.kind, text, questionnaire, at: Date.now(), stages: [] },
		]);
		if (!api?.instruct) {
			reached(commandId, "failed", "This window cannot send commands.");
			return Promise.resolve(false);
		}
		return Promise.resolve()
			.then(() => api.instruct!(character.id, commandId, instruction))
			.then(
				(result) => {
					// The receipts usually said so already; the result is the last word if one was missed.
					if (result.ok) reached(commandId, "applied");
					else reached(commandId, "failed", result.reason);
					return result.ok;
				},
				(failure: unknown) => {
					reached(commandId, "failed", String((failure as Error)?.message ?? failure));
					return false;
				},
			);
	},
};

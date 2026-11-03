import type { AgentWorkplaceApi, Character, Instruction, ReceiptStage } from "../../../src/world.js";
import { StoredDrafts } from "../../stored-drafts.js";
import { onePanel } from "../one-panel.js";
import type { QuotedMessage } from "./quote.js";

export type ConversationApi = Pick<AgentWorkplaceApi, "conversation" | "markSeen"> &
	Partial<Pick<AgentWorkplaceApi, "instruct" | "onReceipt" | "watchReplies" | "onReply" | "openLink" | "openFile">>;

export interface PanelState {
	character?: Character;

	opening: number;
	api?: ConversationApi;
}

export interface Sent {
	commandId: string;
	characterId: string;
	kind: Instruction["kind"];

	text?: string;

	questionnaire?: string;
	at: number;
	stages: ReceiptStage[];
	reason?: string;
}

const SENT_KEPT = 3;

let state: PanelState = { opening: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<PanelState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};

const drafts = new StoredDrafts("workplace-draft:dm:");
const replies = new Map<string, QuotedMessage>();
const quoteListeners = new Set<(characterId: string) => void>();

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

const escapes: (() => void)[] = [];
let commandCount = 0;

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
	connect(api: ConversationApi) {
		stopReceipts?.();
		stopReceipts = api.onReceipt?.((receipt) => reached(receipt.commandId, receipt.stage, receipt.reason));
		update({ api });
	},
	open(character: Character) {
		onePanel.opening("conversation");
		update({ character, opening: state.opening + 1 });
	},
	close() {
		if (state.character) update({ character: undefined });
	},

	onEscape(handler: () => void): () => void {
		escapes.push(handler);
		return () => {
			const index = escapes.lastIndexOf(handler);
			if (index >= 0) escapes.splice(index, 1);
		};
	},

	escape() {
		const top = escapes.at(-1);
		if (top) top();
		else conversationPanel.close();
	},

	draft: (characterId: string) => drafts.get(characterId) ?? "",
	setDraft(characterId: string, text: string) {
		drafts.set(characterId, text);
	},

	replyTo: (characterId: string) => replies.get(characterId),
	setReplyTo(characterId: string, message: QuotedMessage | undefined) {
		if (message) replies.set(characterId, message);
		else replies.delete(characterId);
		for (const listener of quoteListeners) listener(characterId);
	},
	onQuote(listener: (characterId: string) => void): () => void {
		quoteListeners.add(listener);
		return () => quoteListeners.delete(listener);
	},

	formDraft: (questionnaire: string) => formDrafts.get(questionnaire),
	setFormDraft(questionnaire: string, answers: FormAnswer[]) {
		formDrafts.set(questionnaire, answers);
	},

	sent: () => sent,
	subscribeSent(listener: () => void): () => void {
		sentListeners.add(listener);
		return () => sentListeners.delete(listener);
	},

	withdraw(characterId: string, command: string): Promise<boolean> {
		const api = state.api;
		if (!api?.instruct) return Promise.resolve(false);
		const commandId = `agent-workplace-${Date.now().toString(36)}-${(++commandCount).toString(36)}-withdraw`;
		return api.instruct(characterId, commandId, { kind: "withdraw", command }).then(
			(result) => result.ok,
			() => false,
		);
	},

	instruct(character: Character, instruction: Instruction): Promise<boolean> {
		const api = state.api;
		const commandId = `agent-workplace-${Date.now().toString(36)}-${(++commandCount).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
onePanel.closes("conversation", () => conversationPanel.close());

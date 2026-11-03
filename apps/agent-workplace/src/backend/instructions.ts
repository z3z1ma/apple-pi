import type { Command } from "../../../../components/session-state/src/protocol.js";
import type { Character, CommandResult, Instruction, QuestionnaireReply, ReceiptStage } from "../world.js";
import type { Commands } from "./commands.js";

const TEXT_MAX = 100_000;

const reply = (value: unknown): QuestionnaireReply | undefined => {
	if (!value || typeof value !== "object") return undefined;
	const { selected, custom } = value as { selected?: unknown; custom?: unknown };
	if (typeof custom === "string") return { custom };
	if (Array.isArray(selected) && selected.every((label) => typeof label === "string")) return { selected };
	return undefined;
};

export function instructionCommand(
	character: Character | undefined,
	instruction: unknown,
): { command: Command } | { refused: string } {
	if (!character) return { refused: "No such character is awake." };
	const given = (instruction ?? {}) as Partial<Record<string, unknown>>;
	switch (given.kind) {
		case "talk":
		case "steer":
		case "follow_up": {
			const text = given.text;
			if (typeof text !== "string" || !text.trim()) return { refused: "There is nothing to send." };
			if (text.length > TEXT_MAX) return { refused: "That message is too long to send from here." };
			return { command: { kind: given.kind, text } };
		}
		case "abort": {
			const busy = (character.facts?.run ?? "idle") !== "idle";
			if (busy && given.confirmed !== true)
				return { refused: `${character.name} is busy; stopping it needs your confirmation.` };
			return { command: { kind: "abort" } };
		}
		case "withdraw":
			if (typeof given.command !== "string" || !given.command) return { refused: "Nothing to withdraw." };
			return { command: { kind: "withdraw", command: given.command } };
		case "answer": {
			const replies = Array.isArray(given.replies) ? given.replies.map(reply) : undefined;
			if (typeof given.questionnaire !== "string" || !replies?.length || replies.some((r) => r === undefined))
				return { refused: "That answer does not fit the questions." };
			return {
				command: { kind: "answer", questionnaire: given.questionnaire, replies: replies as QuestionnaireReply[] },
			};
		}
	}
	return { refused: "The conversation panel cannot send that." };
}

export async function instruct(
	commands: Commands,
	character: Character | undefined,
	commandId: string,
	instruction: Instruction | unknown,
	onReceipt: (stage: ReceiptStage, reason?: string) => void,
): Promise<CommandResult> {
	const made = instructionCommand(character, instruction);
	if ("refused" in made) {
		onReceipt("failed", made.refused);
		return { ok: false, reason: made.refused };
	}
	let failed = false;
	const result = await commands.send(character!.id, made.command, {
		commandId,
		onReceipt(stage, reason) {
			if (stage === "failed") failed = true;
			onReceipt(stage, reason);
		},
	});
	if (!result.ok && !failed) onReceipt("failed", result.reason);
	return result;
}

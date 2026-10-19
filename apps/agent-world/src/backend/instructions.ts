// Instructing an agent from the conversation panel (decision 13): each instruction becomes its session-state command
// (`talk`, `steer`, `follow_up`, `abort`, `answer`) and reports its receipts. The only guard is Stop's: stopping a
// busy agent needs the operator's confirmation, so an unconfirmed `abort` for a busy character sends nothing.
import type { Command } from "../../../../components/session-state/src/protocol.js";
import type { Character, CommandResult, Instruction, QuestionnaireReply, ReceiptStage } from "../world.js";
import type { Commands } from "./commands.js";

/** The longest text an instruction may carry; Pi takes any, but the panel is for messages, not files. */
const TEXT_MAX = 100_000;

const reply = (value: unknown): QuestionnaireReply | undefined => {
	if (!value || typeof value !== "object") return undefined;
	const { selected, custom } = value as { selected?: unknown; custom?: unknown };
	if (typeof custom === "string") return { custom };
	if (Array.isArray(selected) && selected.every((label) => typeof label === "string")) return { selected };
	return undefined;
};

/** The command an instruction sends to `character`, or why it is refused (and nothing is sent). */
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

/**
 * Send an instruction to an awake character through `commands`, reporting each receipt stage. A refused instruction
 * reports `failed` with its reason and sends nothing.
 */
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
	// The runtime not answering, or going away, is a failure the runtime itself could not report.
	if (!result.ok && !failed) onReceipt("failed", result.reason);
	return result;
}

/**
 * The `pi.events` channel on which `ask_user_question` offers each questionnaire it shows to another answerer (the
 * session-state bridge, for answers sent from outside the terminal). The first answer wins: the terminal's, or one
 * given through `answer`; the other side then closes.
 */
export const QUESTIONNAIRE_CHANNEL = "questionnaire:open";

/** One answer per question, in order: the chosen option labels, or free text. */
export type QuestionnaireReply = { selected: string[] } | { custom: string };

export interface OpenQuestionnaire {
	sessionId: string;
	toolCallId: string;
	/** The questions, as the tool was called with them. */
	questions: unknown;
	/** Resolves when the questionnaire closes, whoever answered it. */
	closed: Promise<void>;
	/** Answers the questionnaire; returns why it refused when it is closed or the answers do not fit. */
	answer(replies: QuestionnaireReply[]): string | undefined;
}

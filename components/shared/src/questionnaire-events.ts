export const QUESTIONNAIRE_CHANNEL = "questionnaire:open";

export type QuestionnaireReply = { selected: string[] } | { custom: string };

export interface OpenQuestionnaire {
	sessionId: string;
	toolCallId: string;
	questions: unknown;
	closed: Promise<void>;
	answer(replies: QuestionnaireReply[]): string | undefined;
}

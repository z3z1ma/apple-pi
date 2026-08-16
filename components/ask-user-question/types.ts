import { type Static, Type } from "typebox";

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";
export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;
export const MAX_QUESTION_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 500;

export const CUSTOM_ANSWER_LABEL = "Type something.";
export const FINISH_MULTI_SELECT_LABEL = "Done selecting";
export const RESERVED_OPTION_LABELS = ["Other", CUSTOM_ANSWER_LABEL, FINISH_MULTI_SELECT_LABEL] as const;

export const QuestionOptionSchema = Type.Object({
	label: Type.String({
		minLength: 1,
		maxLength: MAX_LABEL_LENGTH,
		description: "Concise display label for this choice (prefer 1-5 words)",
	}),
	description: Type.String({
		minLength: 1,
		maxLength: MAX_DESCRIPTION_LENGTH,
		description: "What this choice means, including its main consequence or trade-off",
	}),
});

export const QuestionSchema = Type.Object({
	question: Type.String({
		minLength: 1,
		maxLength: MAX_QUESTION_LENGTH,
		description: "The complete, specific question to show the user",
	}),
	header: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: MAX_HEADER_LENGTH,
			description: "Short tab label, such as Scope or Storage",
		}),
	),
	options: Type.Array(QuestionOptionSchema, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
		description: "Distinct authored choices. The custom-answer choice is appended automatically.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			default: false,
			description: "Allow more than one authored choice to be selected",
		}),
	),
});

export const AskUserQuestionParamsSchema = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		maxItems: MAX_QUESTIONS,
		description: "One to four related questions to ask in one questionnaire",
	}),
});

export type QuestionOption = Static<typeof QuestionOptionSchema>;
export type Question = Static<typeof QuestionSchema>;
export type AskUserQuestionParams = Static<typeof AskUserQuestionParamsSchema>;

export interface QuestionAnswer {
	questionIndex: number;
	question: string;
	header: string;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
}

export type QuestionnaireError =
	| "no_ui"
	| "no_custom_ui"
	| "no_questions"
	| "too_many_questions"
	| "too_few_options"
	| "too_many_options"
	| "duplicate_question"
	| "duplicate_option_label"
	| "reserved_option_label"
	| "invalid_text";

export interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
	error?: QuestionnaireError;
}

export type QuestionnaireValidation =
	| { ok: true }
	| { ok: false; error: QuestionnaireError; message: string };

const RESERVED_LABELS = new Set<string>(RESERVED_OPTION_LABELS);

export function questionHeader(question: Question, index: number): string {
	return question.header?.trim() || `Q${index + 1}`;
}

export function validateQuestionnaire(params: AskUserQuestionParams): QuestionnaireValidation {
	if (params.questions.length === 0) {
		return { ok: false, error: "no_questions", message: "At least one question is required." };
	}
	if (params.questions.length > MAX_QUESTIONS) {
		return {
			ok: false,
			error: "too_many_questions",
			message: `At most ${MAX_QUESTIONS} questions are allowed per questionnaire.`,
		};
	}

	const questionTexts = new Set<string>();
	for (const question of params.questions) {
		const normalizedQuestion = question.question.trim();
		if (
			normalizedQuestion.length === 0 ||
			normalizedQuestion.length > MAX_QUESTION_LENGTH ||
			(question.header !== undefined &&
				(question.header.trim().length === 0 || question.header.length > MAX_HEADER_LENGTH))
		) {
			return { ok: false, error: "invalid_text", message: "Question text and headers must be non-empty and within their documented limits." };
		}
		if (questionTexts.has(normalizedQuestion)) {
			return {
				ok: false,
				error: "duplicate_question",
				message: "Question text must be unique within a questionnaire.",
			};
		}
		questionTexts.add(normalizedQuestion);

		if (question.options.length < MIN_OPTIONS) {
			return {
				ok: false,
				error: "too_few_options",
				message: `Each question requires at least ${MIN_OPTIONS} authored options.`,
			};
		}
		if (question.options.length > MAX_OPTIONS) {
			return {
				ok: false,
				error: "too_many_options",
				message: `Each question allows at most ${MAX_OPTIONS} authored options.`,
			};
		}

		const labels = new Set<string>();
		for (const option of question.options) {
			const normalizedLabel = option.label.trim();
			if (
				normalizedLabel.length === 0 ||
				normalizedLabel.length > MAX_LABEL_LENGTH ||
				option.description.trim().length === 0 ||
				option.description.length > MAX_DESCRIPTION_LENGTH
			) {
				return { ok: false, error: "invalid_text", message: "Option labels and descriptions must be non-empty and within their documented limits." };
			}
			if (RESERVED_LABELS.has(normalizedLabel)) {
				return {
					ok: false,
					error: "reserved_option_label",
					message: `Option label is reserved: ${normalizedLabel}`,
				};
			}
			if (labels.has(normalizedLabel)) {
				return {
					ok: false,
					error: "duplicate_option_label",
					message: "Option labels must be unique within each question.",
				};
			}
			labels.add(normalizedLabel);
		}
	}

	return { ok: true };
}

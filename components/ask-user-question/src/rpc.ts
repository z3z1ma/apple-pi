import {
	CUSTOM_ANSWER_LABEL,
	questionHeader,
	type AskUserQuestionParams,
	type Question,
	type QuestionAnswer,
	type QuestionnaireResult,
} from "./types.js";

export interface QuestionnaireDialogUI {
	select(title: string, choices: string[], options?: { signal?: AbortSignal }): Promise<string | undefined>;
	input(title: string, placeholder?: string, options?: { signal?: AbortSignal }): Promise<string | undefined>;
}

export function hasQuestionnaireDialogUI(value: unknown): value is QuestionnaireDialogUI {
	const ui = value as Partial<QuestionnaireDialogUI> | null | undefined;
	return typeof ui?.select === "function" && typeof ui?.input === "function";
}

function optionLine(question: Question, index: number): string {
	const option = question.options[index];
	return `${index + 1}. ${option.label} — ${option.description}`;
}

function answerBase(question: Question, questionIndex: number) {
	return {
		questionIndex,
		question: question.question,
		header: questionHeader(question, questionIndex),
	};
}

async function askSingle(
	ui: QuestionnaireDialogUI,
	question: Question,
	questionIndex: number,
	signal?: AbortSignal,
): Promise<QuestionAnswer | undefined> {
	const options = question.options.map((_option, index) => optionLine(question, index));
	options.push(`${question.options.length + 1}. ${CUSTOM_ANSWER_LABEL}`);
	const selected = await ui.select(`[${questionHeader(question, questionIndex)}] ${question.question}`, options, {
		signal,
	});
	if (selected === undefined) return undefined;
	const selectedIndex = options.indexOf(selected);
	if (selectedIndex < 0) return undefined;
	if (selectedIndex < question.options.length) {
		return {
			...answerBase(question, questionIndex),
			kind: "option",
			answer: question.options[selectedIndex].label,
		};
	}

	const title = `[${questionHeader(question, questionIndex)}] ${question.question}\n\nType your answer:`;
	while (true) {
		const custom = await ui.input(title, "", { signal });
		if (custom === undefined) return undefined;
		const trimmed = custom.trim();
		if (trimmed.length > 0) return { ...answerBase(question, questionIndex), kind: "custom", answer: trimmed };
	}
}

async function askMulti(
	ui: QuestionnaireDialogUI,
	question: Question,
	questionIndex: number,
	signal?: AbortSignal,
): Promise<QuestionAnswer | undefined> {
	const choices = question.options.map((_option, index) => optionLine(question, index)).join("\n");
	const title = `[${questionHeader(question, questionIndex)}] ${question.question}\n\n${choices}\n\nEnter every choice number, separated by commas (for example 1,3), or type a custom answer:`;
	const input = await ui.input(title, "1,3", { signal });
	if (input === undefined) return undefined;
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return { ...answerBase(question, questionIndex), kind: "multi", answer: null, selected: [] };
	}
	const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
	if (tokens.every((token) => /^\d+$/.test(token))) {
		const indices = tokens.map((token) => Number.parseInt(token, 10) - 1);
		if (indices.every((index) => index >= 0 && index < question.options.length)) {
			const selectedIndices = [...new Set(indices)].sort((a, b) => a - b);
			return {
				...answerBase(question, questionIndex),
				kind: "multi",
				answer: null,
				selected: selectedIndices.map((index) => question.options[index].label),
			};
		}
	}
	return { ...answerBase(question, questionIndex), kind: "custom", answer: trimmed };
}

/** Walk a questionnaire through RPC/ACP hosts' native select/input dialogs. */
export async function runRpcQuestionnaire(
	ui: QuestionnaireDialogUI,
	params: AskUserQuestionParams,
	signal?: AbortSignal,
): Promise<QuestionnaireResult> {
	const answers: QuestionAnswer[] = [];
	for (let index = 0; index < params.questions.length; index++) {
		const question = params.questions[index];
		const answer = question.multiSelect
			? await askMulti(ui, question, index, signal)
			: await askSingle(ui, question, index, signal);
		if (!answer) return { answers, cancelled: true };
		answers.push(answer);
	}
	return { answers, cancelled: false };
}

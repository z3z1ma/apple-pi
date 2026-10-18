import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	type OpenQuestionnaire,
	QUESTIONNAIRE_CHANNEL,
	type QuestionnaireReply,
} from "../../shared/src/questionnaire-events.js";

import { QuestionnaireDialog, renderAskUserQuestionCall, renderAskUserQuestionResult } from "./dialog.js";
import { hasQuestionnaireDialogUI, runRpcQuestionnaire } from "./rpc.js";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	type AskUserQuestionParams,
	AskUserQuestionParamsSchema,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	type QuestionAnswer,
	type QuestionnaireResult,
	questionHeader,
	RESERVED_OPTION_LABELS,
	validateQuestionnaire,
} from "./types.js";

const NO_UI_MESSAGE =
	"The questionnaire was not shown because this run has no interactive UI. Ask the questions as ordinary chat text instead.";
const NO_CUSTOM_UI_MESSAGE =
	"The questionnaire was not shown because this client cannot render it. Ask the questions as ordinary chat text instead.";

/** Answers sent from outside the terminal, in the shape the dialog produces, or why they do not fit the questions. */
function answersFromReplies(params: AskUserQuestionParams, replies: QuestionnaireReply[]): QuestionAnswer[] | string {
	if (replies.length !== params.questions.length)
		return `expected ${params.questions.length} answers, got ${replies.length}`;
	const answers: QuestionAnswer[] = [];
	for (const [questionIndex, question] of params.questions.entries()) {
		const reply = replies[questionIndex];
		const base = { questionIndex, question: question.question, header: questionHeader(question, questionIndex) };
		if ("custom" in reply) {
			if (!reply.custom.trim()) return `answer ${questionIndex + 1} is empty`;
			answers.push({ ...base, kind: "custom", answer: reply.custom.trim() });
			continue;
		}
		const labels = question.options.map((option) => option.label);
		const unknown = reply.selected.find((label) => !labels.includes(label));
		if (unknown !== undefined) return `answer ${questionIndex + 1}: ${JSON.stringify(unknown)} is not an option`;
		if (question.multiSelect) {
			answers.push({
				...base,
				kind: "multi",
				answer: null,
				selected: labels.filter((label) => reply.selected.includes(label)),
			});
		} else if (reply.selected.length === 1) {
			answers.push({ ...base, kind: "option", answer: reply.selected[0] });
		} else return `answer ${questionIndex + 1} needs exactly one option`;
	}
	return answers;
}

function answerValue(answer: QuestionAnswer): string | string[] | null {
	return answer.kind === "multi" ? (answer.selected ?? []) : answer.answer;
}

export function buildQuestionnaireToolResult(result: QuestionnaireResult) {
	if (result.error === "no_ui") {
		return { content: [{ type: "text" as const, text: NO_UI_MESSAGE }], details: result };
	}
	if (result.error === "no_custom_ui") {
		return { content: [{ type: "text" as const, text: NO_CUSTOM_UI_MESSAGE }], details: result };
	}
	if (result.error) {
		return {
			content: [{ type: "text" as const, text: `Invalid questionnaire: ${result.error}` }],
			details: result,
		};
	}
	if (result.cancelled) {
		return {
			content: [{ type: "text" as const, text: "User cancelled the questionnaire without submitting answers." }],
			details: result,
		};
	}

	const lines = result.answers.map(
		(answer) => `${JSON.stringify(answer.question)} = ${JSON.stringify(answerValue(answer))}`,
	);
	return {
		content: [{ type: "text" as const, text: `User answered the questions:\n${lines.join("\n")}` }],
		details: result,
	};
}

export function reconcileAskUserQuestionTool(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (ctx.hasUI) return;
	const active = pi.getActiveTools();
	if (active.includes(ASK_USER_QUESTION_TOOL_NAME)) {
		pi.setActiveTools(active.filter((name) => name !== ASK_USER_QUESTION_TOOL_NAME));
	}
}

export function registerAskUserQuestionTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: ASK_USER_QUESTION_TOOL_NAME,
		label: "Ask User Question",
		description: `Ask the user one to ${MAX_QUESTIONS} related structured questions instead of guessing. Each question must offer ${MIN_OPTIONS}-${MAX_OPTIONS} authored choices with concise labels and descriptions. The UI automatically adds a custom free-text answer. Set multiSelect when more than one authored choice can apply.`,
		promptSnippet: `Ask the user up to ${MAX_QUESTIONS} structured questions when a material decision cannot be inferred safely`,
		promptGuidelines: [
			`Use ask_user_question when proceeding needs a user decision you cannot safely infer. First finish the work the answer does not affect, then group up to ${MAX_QUESTIONS} related questions in one call.`,
			`Give each option a concise label and its consequence or trade-off. Author only real choices; the UI supplies the ${RESERVED_OPTION_LABELS.map((label) => JSON.stringify(label)).join(", ")} rows.`,
		],
		parameters: AskUserQuestionParamsSchema,
		executionMode: "sequential",

		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const typed = params as AskUserQuestionParams;
			if (!ctx.hasUI) {
				return buildQuestionnaireToolResult({ answers: [], cancelled: true, error: "no_ui" });
			}

			const validation = validateQuestionnaire(typed);
			if (!validation.ok) {
				return {
					content: [{ type: "text" as const, text: `Invalid questionnaire: ${validation.message}` }],
					details: { answers: [], cancelled: true, error: validation.error } satisfies QuestionnaireResult,
				};
			}

			if (ctx.mode === "rpc" && !hasQuestionnaireDialogUI(ctx.ui)) {
				return buildQuestionnaireToolResult({ answers: [], cancelled: true, error: "no_custom_ui" });
			}
			if (ctx.mode !== "rpc" && ctx.mode !== "tui") {
				return buildQuestionnaireToolResult({ answers: [], cancelled: true, error: "no_ui" });
			}
			if (signal?.aborted) return buildQuestionnaireToolResult({ answers: [], cancelled: true });

			// An answer from outside the terminal closes the dialog and replaces its result.
			let closed = false;
			let replied: QuestionAnswer[] | undefined;
			let markClosed: () => void = () => {};
			const whenClosed = new Promise<void>((resolve) => (markClosed = resolve));
			const replyArrived = new AbortController();
			const dialogSignal = signal ? AbortSignal.any([signal, replyArrived.signal]) : replyArrived.signal;
			pi.events.emit(QUESTIONNAIRE_CHANNEL, {
				sessionId: ctx.sessionManager.getSessionId(),
				toolCallId,
				questions: typed.questions,
				closed: whenClosed,
				answer: (replies) => {
					// An abort may have ended the dialog already, before its result arrived here.
					if (closed || signal?.aborted) return "the questionnaire is already closed";
					const answers = answersFromReplies(typed, replies);
					if (typeof answers === "string") return answers;
					closed = true;
					replied = answers;
					replyArrived.abort();
					return undefined;
				},
			} satisfies OpenQuestionnaire);

			let result: QuestionnaireResult | undefined;
			try {
				result =
					ctx.mode === "rpc" && hasQuestionnaireDialogUI(ctx.ui)
						? await runRpcQuestionnaire(ctx.ui, typed, dialogSignal)
						: await ctx.ui.custom<QuestionnaireResult>(
								(tui, theme, keybindings, done) =>
									new QuestionnaireDialog(
										tui,
										theme,
										keybindings,
										typed,
										(answered) => {
											closed = true;
											done(answered);
										},
										dialogSignal,
									),
							);
			} finally {
				closed = true;
				markClosed();
			}
			if (replied) return buildQuestionnaireToolResult({ answers: replied, cancelled: false });
			return buildQuestionnaireToolResult(result ?? { answers: [], cancelled: true, error: "no_custom_ui" });
		},

		renderCall(params, theme) {
			return renderAskUserQuestionCall(params as AskUserQuestionParams, theme);
		},

		renderResult(result, _options, theme) {
			const details = result.details as QuestionnaireResult | undefined;
			if (details) return renderAskUserQuestionResult(details, theme);
			const first = result.content.find((part) => part.type === "text");
			return new Text(first?.type === "text" ? first.text : "", 0, 0);
		},
	});

	pi.on("before_agent_start", (_event, ctx) => reconcileAskUserQuestionTool(pi, ctx));
}

export default function askUserQuestion(pi: ExtensionAPI): void {
	registerAskUserQuestionTool(pi);
}

export * from "./types.js";

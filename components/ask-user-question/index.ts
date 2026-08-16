import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { QuestionnaireDialog, renderAskUserQuestionCall, renderAskUserQuestionResult } from "./dialog.js";
import { hasQuestionnaireDialogUI, runRpcQuestionnaire } from "./rpc.js";
import {
	ASK_USER_QUESTION_TOOL_NAME,
	AskUserQuestionParamsSchema,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	RESERVED_OPTION_LABELS,
	validateQuestionnaire,
	type AskUserQuestionParams,
	type QuestionAnswer,
	type QuestionnaireResult,
} from "./types.js";

const NO_UI_MESSAGE =
	"The questionnaire was not shown because this run has no interactive UI. Ask the questions as ordinary chat text instead.";
const NO_CUSTOM_UI_MESSAGE =
	"The questionnaire was not shown because this client cannot render it. Ask the questions as ordinary chat text instead.";

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
			`Use ask_user_question when the request is materially underspecified and proceeding requires a user decision; group up to ${MAX_QUESTIONS} related questions into one call.`,
			`Give every ask_user_question question ${MIN_OPTIONS}-${MAX_OPTIONS} distinct options with a concise label and a description of its consequence or trade-off.`,
			`Do not author ask_user_question options named ${RESERVED_OPTION_LABELS.map((label) => JSON.stringify(label)).join(", ")}; the UI supplies those interaction rows.`,
			"Use ask_user_question multiSelect only when several authored choices may apply together.",
		],
		parameters: AskUserQuestionParamsSchema,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
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

			let result: QuestionnaireResult | undefined;
			if (ctx.mode === "rpc") {
				if (!hasQuestionnaireDialogUI(ctx.ui)) {
					return buildQuestionnaireToolResult({ answers: [], cancelled: true, error: "no_custom_ui" });
				}
				result = await runRpcQuestionnaire(ctx.ui, typed, signal);
			} else if (ctx.mode === "tui") {
				if (signal?.aborted) return buildQuestionnaireToolResult({ answers: [], cancelled: true });
				result = await ctx.ui.custom<QuestionnaireResult>(
					(tui, theme, keybindings, done) => new QuestionnaireDialog(tui, theme, keybindings, typed, done, signal),
				);
			} else {
				return buildQuestionnaireToolResult({ answers: [], cancelled: true, error: "no_ui" });
			}

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

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	type Component,
	type Focusable,
	type KeybindingsManager,
	type TUI,
	isKeyRelease,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import {
	CUSTOM_ANSWER_LABEL,
	FINISH_MULTI_SELECT_LABEL,
	questionHeader,
	type AskUserQuestionParams,
	type Question,
	type QuestionAnswer,
	type QuestionnaireResult,
} from "./types.js";

type AnswerMap = Map<number, QuestionAnswer>;

function answerText(answer: QuestionAnswer): string {
	if (answer.kind === "multi") return answer.selected?.join(", ") || "(none)";
	return answer.answer || "(empty)";
}

function singleLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Interactive tabbed questionnaire used by the model-facing tool. */
export class QuestionnaireDialog implements Component, Focusable {
	private readonly questions: readonly Question[];
	private readonly answers: AnswerMap = new Map();
	private readonly selectedByQuestion = new Map<number, Set<number>>();
	private readonly customDrafts = new Map<number, string>();
	private readonly rowByQuestion: number[];
	private readonly editor: Editor;
	private currentTab = 0;
	private inputMode = false;
	private finished = false;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private _focused = false;
	private readonly onAbort = () => this.finish(true);

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		params: AskUserQuestionParams,
		private readonly done: (result: QuestionnaireResult) => void,
		private readonly signal?: AbortSignal,
	) {
		this.questions = params.questions;
		this.rowByQuestion = this.questions.map(() => 0);
		const editorTheme: EditorTheme = {
			borderColor: (text) => this.theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => this.theme.fg("accent", text),
				selectedText: (text) => this.theme.fg("accent", text),
				description: (text) => this.theme.fg("muted", text),
				scrollInfo: (text) => this.theme.fg("dim", text),
				noMatch: (text) => this.theme.fg("warning", text),
			},
		};
		this.editor = new Editor(tui, editorTheme);
		this.editor.onSubmit = (value) => this.submitCustomAnswer(value);
		this.signal?.addEventListener("abort", this.onAbort, { once: true });
		if (this.signal?.aborted) queueMicrotask(this.onAbort);
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value && this.inputMode;
	}

	handleInput(data: string): void {
		if (this.finished || isKeyRelease(data)) return;

		if (this.inputMode) {
			if (this.keybindings.matches(data, "tui.select.cancel")) {
				this.customDrafts.set(this.currentTab, this.editor.getExpandedText?.() ?? this.editor.getText());
				this.inputMode = false;
				this.editor.focused = false;
				this.refresh();
				return;
			}
			if (this.keybindings.matches(data, "tui.input.submit")) {
				this.submitCustomAnswer(this.editor.getExpandedText?.() ?? this.editor.getText());
				return;
			}
			this.editor.handleInput(data);
			this.customDrafts.set(this.currentTab, this.editor.getExpandedText?.() ?? this.editor.getText());
			this.refresh();
			return;
		}

		if (this.questions.length > 1) {
			if (this.keybindings.matches(data, "tui.input.tab") || matchesKey(data, Key.right)) {
				this.currentTab = (this.currentTab + 1) % (this.questions.length + 1);
				this.refresh();
				return;
			}
			if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
				this.currentTab = (this.currentTab - 1 + this.questions.length + 1) % (this.questions.length + 1);
				this.refresh();
				return;
			}
		}

		if (this.currentTab === this.questions.length) {
			if (this.keybindings.matches(data, "tui.select.confirm") && this.allAnswered()) this.finish(false);
			else if (this.keybindings.matches(data, "tui.select.cancel")) this.finish(true);
			return;
		}

		const question = this.questions[this.currentTab];
		const rowCount = this.rowCount(question);
		if (this.keybindings.matches(data, "tui.select.up")) {
			this.rowByQuestion[this.currentTab] = Math.max(0, this.currentRow() - 1);
			this.refresh();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down")) {
			this.rowByQuestion[this.currentTab] = Math.min(rowCount - 1, this.currentRow() + 1);
			this.refresh();
			return;
		}

		if (question.multiSelect && matchesKey(data, Key.space)) {
			this.activateCurrentRow(question);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.confirm")) {
			this.activateCurrentRow(question);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.cancel")) this.finish(true);
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		if (this.cachedLines && this.cachedWidth === renderWidth) return this.cachedLines;

		const lines: string[] = [];
		const add = (text: string) => lines.push(...wrapTextWithAnsi(text, renderWidth));
		const addPrefixed = (prefix: string, text: string) => {
			const prefixWidth = visibleWidth(prefix);
			if (prefixWidth >= renderWidth) {
				add(prefix + text);
				return;
			}
			const wrapped = wrapTextWithAnsi(text, Math.max(1, renderWidth - prefixWidth));
			const continuation = " ".repeat(prefixWidth);
			for (let index = 0; index < wrapped.length; index++) {
				lines.push(`${index === 0 ? prefix : continuation}${wrapped[index]}`);
			}
		};

		lines.push(this.theme.fg("accent", "─".repeat(renderWidth)));
		if (this.questions.length > 1) {
			this.renderTabs(add);
			lines.push("");
		}

		if (this.currentTab === this.questions.length) {
			this.renderReview(lines, addPrefixed);
		} else {
			this.renderQuestion(lines, addPrefixed, renderWidth);
		}

		lines.push("");
		addPrefixed(" ", this.theme.fg("dim", this.helpText()));
		lines.push(this.theme.fg("accent", "─".repeat(renderWidth)));
		this.cachedWidth = renderWidth;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.editor.invalidate();
	}

	dispose(): void {
		this.signal?.removeEventListener("abort", this.onAbort);
	}

	private renderTabs(add: (text: string) => void): void {
		const tabs = this.questions.map((question, index) => {
			const marker = this.answers.has(index) ? "■" : "□";
			const text = ` ${marker} ${questionHeader(question, index)} `;
			if (index === this.currentTab) return this.theme.bg("selectedBg", this.theme.fg("text", text));
			return this.theme.fg(this.answers.has(index) ? "success" : "muted", text);
		});
		const submit = " ✓ Submit ";
		tabs.push(
			this.currentTab === this.questions.length
				? this.theme.bg("selectedBg", this.theme.fg("text", submit))
				: this.theme.fg(this.allAnswered() ? "success" : "dim", submit),
		);
		add(` ${tabs.join(" ")}`);
	}

	private renderQuestion(
		lines: string[],
		addPrefixed: (prefix: string, text: string) => void,
		renderWidth: number,
	): void {
		const question = this.questions[this.currentTab];
		addPrefixed(" ", this.theme.fg("accent", this.theme.bold(questionHeader(question, this.currentTab))));
		addPrefixed(" ", this.theme.fg("text", question.question));
		lines.push("");

		const selected = this.selectedByQuestion.get(this.currentTab) ?? new Set<number>();
		for (let index = 0; index < question.options.length; index++) {
			const option = question.options[index];
			const focused = this.currentRow() === index;
			const cursor = focused ? this.theme.fg("accent", "> ") : "  ";
			const selection = question.multiSelect ? `${selected.has(index) ? "[x]" : "[ ]"} ` : `${index + 1}. `;
			addPrefixed(cursor, this.theme.fg(focused ? "accent" : "text", `${selection}${option.label}`));
			addPrefixed("      ", this.theme.fg("muted", option.description));
		}

		const customIndex = question.options.length;
		const customFocused = this.currentRow() === customIndex;
		const customAnswer = this.answers.get(this.currentTab);
		const customValue = customAnswer?.kind === "custom" ? ` — ${singleLine(customAnswer.answer ?? "")}` : "";
		addPrefixed(
			customFocused ? this.theme.fg("accent", "> ") : "  ",
			this.theme.fg(customFocused || this.inputMode ? "accent" : "text", `${CUSTOM_ANSWER_LABEL}${customValue}`),
		);

		if (question.multiSelect) {
			const finishIndex = customIndex + 1;
			const finishFocused = this.currentRow() === finishIndex;
			addPrefixed(
				finishFocused ? this.theme.fg("accent", "> ") : "  ",
				this.theme.fg(finishFocused ? "accent" : "text", FINISH_MULTI_SELECT_LABEL),
			);
		}

		if (this.inputMode) {
			lines.push("");
			addPrefixed(" ", this.theme.fg("muted", "Your answer:"));
			const editorWidth = Math.max(1, renderWidth - 1);
			for (const line of this.editor.render(editorWidth)) {
				lines.push(renderWidth > 1 ? ` ${line}` : line);
			}
		}
	}

	private renderReview(lines: string[], addPrefixed: (prefix: string, text: string) => void): void {
		addPrefixed(" ", this.theme.fg("accent", this.theme.bold("Review your answers")));
		lines.push("");
		for (let index = 0; index < this.questions.length; index++) {
			const answer = this.answers.get(index);
			const header = questionHeader(this.questions[index], index);
			if (answer) {
				addPrefixed(
					" ",
					`${this.theme.fg("success", "✓")} ${this.theme.fg("muted", `${header}:`)} ${this.theme.fg("text", answerText(answer))}`,
				);
			} else {
				addPrefixed(" ", `${this.theme.fg("warning", "!")} ${this.theme.fg("muted", `${header}: unanswered`)}`);
			}
		}
		lines.push("");
		addPrefixed(
			" ",
			this.allAnswered()
				? this.theme.fg("success", "Press Enter to submit")
				: this.theme.fg("warning", "Answer every question before submitting"),
		);
	}

	private helpText(): string {
		if (this.inputMode) return "Enter submit answer • Shift+Enter newline • Esc go back";
		if (this.currentTab === this.questions.length) return "Enter submit • Tab/←→ review • Esc cancel";
		const question = this.questions[this.currentTab];
		const choose = question.multiSelect ? "↑↓ navigate • Space/Enter toggle or finish" : "↑↓ navigate • Enter select";
		return this.questions.length > 1 ? `${choose} • Tab/←→ questions • Esc cancel` : `${choose} • Esc cancel`;
	}

	private rowCount(question: Question): number {
		return question.options.length + 1 + (question.multiSelect ? 1 : 0);
	}

	private currentRow(): number {
		return this.rowByQuestion[this.currentTab] ?? 0;
	}

	private activateCurrentRow(question: Question): void {
		const row = this.currentRow();
		if (row < question.options.length) {
			if (question.multiSelect) {
				const selected = this.selectedByQuestion.get(this.currentTab) ?? new Set<number>();
				if (selected.has(row)) selected.delete(row);
				else selected.add(row);
				this.selectedByQuestion.set(this.currentTab, selected);
				this.answers.delete(this.currentTab);
				this.refresh();
				return;
			}
			const option = question.options[row];
			this.answers.set(this.currentTab, {
				questionIndex: this.currentTab,
				question: question.question,
				header: questionHeader(question, this.currentTab),
				kind: "option",
				answer: option.label,
			});
			this.advance();
			return;
		}

		if (row === question.options.length) {
			this.inputMode = true;
			this.editor.setText(this.customDrafts.get(this.currentTab) ?? "");
			this.editor.focused = this._focused;
			this.refresh();
			return;
		}

		const selected = this.selectedByQuestion.get(this.currentTab) ?? new Set<number>();
		this.answers.set(this.currentTab, {
			questionIndex: this.currentTab,
			question: question.question,
			header: questionHeader(question, this.currentTab),
			kind: "multi",
			answer: null,
			selected: [...selected].sort((a, b) => a - b).map((index) => question.options[index].label),
		});
		this.advance();
	}

	private submitCustomAnswer(value: string): void {
		const trimmed = value.trim();
		if (!trimmed || this.currentTab >= this.questions.length) return;
		const question = this.questions[this.currentTab];
		this.customDrafts.set(this.currentTab, trimmed);
		this.selectedByQuestion.delete(this.currentTab);
		this.answers.set(this.currentTab, {
			questionIndex: this.currentTab,
			question: question.question,
			header: questionHeader(question, this.currentTab),
			kind: "custom",
			answer: trimmed,
		});
		this.inputMode = false;
		this.editor.focused = false;
		this.advance();
	}

	private advance(): void {
		if (this.questions.length === 1) {
			this.finish(false);
			return;
		}
		this.currentTab = Math.min(this.currentTab + 1, this.questions.length);
		this.refresh();
	}

	private allAnswered(): boolean {
		return this.questions.every((_question, index) => this.answers.has(index));
	}

	private finish(cancelled: boolean): void {
		if (this.finished) return;
		this.finished = true;
		this.signal?.removeEventListener("abort", this.onAbort);
		this.done({
			answers: [...this.answers.values()].sort((a, b) => a.questionIndex - b.questionIndex),
			cancelled,
		});
	}

	private refresh(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.tui.requestRender();
	}
}

export function renderAskUserQuestionCall(params: AskUserQuestionParams, theme: Theme): Text {
	const count = params.questions.length;
	const labels = params.questions.map((question, index) => questionHeader(question, index)).join(", ");
	let text = theme.fg("toolTitle", theme.bold("ask_user_question "));
	text += theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`);
	if (labels) text += theme.fg("dim", ` (${labels})`);
	return new Text(text, 0, 0);
}

export function renderAskUserQuestionResult(result: QuestionnaireResult | undefined, theme: Theme): Text {
	if (!result) return new Text("", 0, 0);
	if (result.error) return new Text(theme.fg("error", result.error), 0, 0);
	if (result.cancelled) return new Text(theme.fg("warning", "Questionnaire cancelled"), 0, 0);
	return new Text(
		result.answers
			.map((answer) => `${theme.fg("success", "✓")} ${theme.fg("accent", answer.header)}: ${answerText(answer)}`)
			.join("\n"),
		0,
		0,
	);
}

// An agent's open question in the conversation panel (decision 17). An `ask_user_question` questionnaire is a themed
// form: each question with its options and their descriptions, one choice or many as the question allows, and words
// of the operator's own always offered, as the terminal's dialog offers them. Sending it is the `answer` command, with
// one reply per question; the dialog in the terminal then closes. Any other dialog is answered only in its terminal.
import { useEffect, useRef, useState } from "react";
import type { Character, Question, Questionnaire, QuestionnaireReply } from "../../../src/world.js";
import { Receipts } from "./actions.js";
import { conversationPanel, type FormAnswer } from "./panel-state.js";

const OWN = "In my own words";
const blank = (questions: Question[]): FormAnswer[] => questions.map(() => ({ chosen: [], own: false, words: "" }));

/** The reply for one question, or undefined while it is not answered yet. */
function replyOf(question: Question, answer: FormAnswer): QuestionnaireReply | undefined {
	if (answer.own) return answer.words.trim() ? { custom: answer.words.trim() } : undefined;
	if (!answer.chosen.length) return undefined;
	// In the order the options are listed, as the terminal reports them.
	return { selected: question.options.map((o) => o.label).filter((label) => answer.chosen.includes(label)) };
}

export function QuestionForm({ character, questionnaire }: { character: Character; questionnaire: Questionnaire }) {
	const { questions } = questionnaire;
	const [answers, setAnswers] = useState<FormAnswer[]>(
		() => conversationPanel.formDraft(questionnaire.id) ?? blank(questions),
	);
	const [sending, setSending] = useState(false);
	const own = useRef<(HTMLTextAreaElement | null)[]>([]);
	const first = useRef<HTMLInputElement>(null);
	const focusOwn = useRef<number | undefined>(undefined);

	useEffect(() => {
		first.current?.focus({ preventScroll: true });
	}, []);
	useEffect(() => {
		if (focusOwn.current === undefined) return;
		own.current[focusOwn.current]?.focus();
		focusOwn.current = undefined;
	});

	const change = (index: number, next: FormAnswer) => {
		const all = answers.map((answer, i) => (i === index ? next : answer));
		setAnswers(all);
		conversationPanel.setFormDraft(questionnaire.id, all);
	};

	const replies = questions.map((question, i) => replyOf(question, answers[i]));
	const complete = replies.every((reply) => reply !== undefined);

	const send = () => {
		if (!complete || sending) return;
		setSending(true);
		void conversationPanel
			.instruct(character, {
				kind: "answer",
				questionnaire: questionnaire.id,
				replies: replies as QuestionnaireReply[],
			})
			.then((ok) => {
				// Taken: the question closes in the world soon. Refused (say the answers no longer fit): try again.
				if (!ok) setSending(false);
			});
	};

	return (
		<form
			className="aw-conv-form"
			aria-label={`${character.name} asks you`}
			onSubmit={(event) => {
				event.preventDefault();
				send();
			}}
		>
			<header className="aw-conv-form-head">
				<span className="aw-conv-form-mark" aria-hidden="true" />
				<span className="aw-conv-form-title">{character.name} asks you</span>
				<span className="aw-conv-form-sub">Answer here, or in its terminal; whichever comes first counts.</span>
			</header>
			<div className="aw-conv-form-body">
				{questions.map((question, index) => (
					<QuestionField
						// biome-ignore lint/suspicious/noArrayIndexKey: questions have no id but their order, which never changes
						key={index}
						index={index}
						question={question}
						answer={answers[index]}
						disabled={sending}
						onChange={(next, typing) => {
							if (typing) focusOwn.current = index;
							change(index, next);
						}}
						firstRef={index === 0 ? first : undefined}
						ownRef={(el) => {
							own.current[index] = el;
						}}
						onEnter={send}
					/>
				))}
			</div>
			<footer className="aw-conv-form-foot">
				<Receipts characterId={character.id} kinds={["answer"]} />
				<div className="aw-conv-act-bar">
					<span className="aw-conv-hint">
						{complete ? "Every question has an answer." : "Answer every question to send."}
					</span>
					<button type="submit" className="aw-cta aw-cta-small" disabled={!complete || sending}>
						Send answer
					</button>
				</div>
			</footer>
		</form>
	);
}

function QuestionField({
	index,
	question,
	answer,
	disabled,
	onChange,
	firstRef,
	ownRef,
	onEnter,
}: {
	index: number;
	question: Question;
	answer: FormAnswer;
	disabled: boolean;
	/** `typing`: the operator just chose words of their own, so their box takes the focus. */
	onChange: (next: FormAnswer, typing?: boolean) => void;
	firstRef?: React.Ref<HTMLInputElement>;
	ownRef: (el: HTMLTextAreaElement | null) => void;
	onEnter: () => void;
}) {
	const many = question.multiSelect;
	const type = many ? "checkbox" : "radio";
	const name = `aw-q-${index}`;
	const choose = (label: string) => {
		if (!many) onChange({ ...answer, chosen: [label], own: false });
		else {
			const chosen = answer.chosen.includes(label)
				? answer.chosen.filter((l) => l !== label)
				: [...answer.chosen, label];
			onChange({ ...answer, chosen, own: false });
		}
	};
	return (
		<fieldset className="aw-conv-q" disabled={disabled}>
			<legend className="aw-conv-q-legend">
				<span className="aw-conv-q-header">{question.header ?? `Question ${index + 1}`}</span>
				<span className="aw-conv-q-text">{question.question}</span>
			</legend>
			<p className="aw-conv-q-how">{many ? "Choose any that apply." : "Choose one."}</p>
			<div className="aw-conv-opts">
				{question.options.map((option, i) => (
					<label
						key={option.label}
						className={`aw-conv-opt${answer.chosen.includes(option.label) && !answer.own ? " aw-on" : ""}`}
					>
						<input
							ref={i === 0 ? firstRef : undefined}
							type={type}
							name={name}
							className={`aw-conv-mark aw-conv-mark-${type}`}
							checked={!answer.own && answer.chosen.includes(option.label)}
							onChange={() => choose(option.label)}
						/>
						<span className="aw-conv-opt-label">{option.label}</span>
						<span className="aw-conv-opt-desc">{option.description}</span>
					</label>
				))}
				<label className={`aw-conv-opt aw-conv-opt-own${answer.own ? " aw-on" : ""}`}>
					<input
						type={type}
						name={name}
						className={`aw-conv-mark aw-conv-mark-${type}`}
						checked={answer.own}
						onChange={() => {
							// Words of one's own replace the choices, as in the terminal's dialog.
							const on = many ? !answer.own : true;
							onChange({ ...answer, own: on, chosen: on ? [] : answer.chosen }, on);
						}}
					/>
					<span className="aw-conv-opt-label">{OWN}</span>
					<span className="aw-conv-opt-desc">Say it your way instead of choosing.</span>
				</label>
				{answer.own && (
					<textarea
						ref={ownRef}
						className="aw-conv-input aw-conv-own"
						aria-label={`Your own answer to: ${question.question}`}
						placeholder="Write your answer\u2026"
						rows={2}
						value={answer.words}
						onChange={(event) => onChange({ ...answer, words: event.target.value })}
						onKeyDown={(event) => {
							if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
							event.preventDefault();
							onEnter();
						}}
					/>
				)}
			</div>
		</fieldset>
	);
}

/** A dialog other than a questionnaire: its kind and title show, and the terminal answers it. */
export function TerminalOnly({
	character,
	asking,
	goToTerminal,
	problem,
}: {
	character: Character;
	asking: { kind: string; text: string | null };
	goToTerminal: () => void;
	problem?: string;
}) {
	return (
		<div className="aw-conv-terminal-only" role="note">
			<span className="aw-conv-form-mark" aria-hidden="true" />
			<p className="aw-conv-form-title">{character.name} is asking in its terminal</p>
			{asking.text && <p className="aw-conv-asked">&ldquo;{asking.text}&rdquo;</p>}
			<p className="aw-conv-terminal-why">
				This is a {KIND[asking.kind] ?? "dialog"}, and only its terminal can answer it. Answer there, and it carries on
				here.
			</p>
			<div className="aw-conv-act-bar">
				{problem && <span className="aw-conv-warn">{problem}</span>}
				<button type="button" className="aw-cta aw-cta-small" onClick={goToTerminal}>
					Go to its terminal
				</button>
			</div>
		</div>
	);
}

/** How the panel names Pi's dialog kinds. */
const KIND: Record<string, string> = {
	select: "choice from a list",
	confirm: "yes-or-no question",
	input: "question to type an answer to",
	editor: "text to edit",
	custom: "dialog of its own",
	questionnaire: "questionnaire",
};

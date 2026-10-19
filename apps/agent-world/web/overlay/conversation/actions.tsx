// What the operator can do from the foot of the right page, by the character's state (decision 17): idle, Reply
// (`talk`); busy, Redirect now (`steer`), Tell it after this (`follow_up`), and Stop (`abort`, confirmed first, since
// it is busy); asking, its questionnaire as a form, or for any other dialog a pointer to its terminal
// (`question-form.tsx`). Enter sends (Reply, or Redirect now while it works), Shift+Enter starts a new line, and the
// box keeps the focus. Each instruction sent shows the receipt stages it reached. Drafts outlive closing the panel.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Character, Instruction, ReceiptStage } from "../../../src/world.js";
import { activity } from "../interface/model.js";
import { conversationPanel, type Sent } from "./panel-state.js";
import { QuestionForm, TerminalOnly } from "./question-form.js";

/** The box grows with its text up to this many lines, then scrolls. */
const MAX_ROWS = 7;
const PREVIEW = 72;

const LABEL: Record<Instruction["kind"], string> = {
	talk: "Reply",
	steer: "Redirect",
	follow_up: "After this",
	abort: "Stop",
	answer: "Answer",
};

/** The stages shown for a receipt, in order, in the runtime's own words. */
const STAGES: { stage: ReceiptStage; label: string; title: string }[] = [
	{ stage: "accepted", label: "Accepted", title: "The session runtime has it" },
	{ stage: "delivered", label: "Delivered", title: "It reached the agent's session" },
	{ stage: "applied", label: "Applied", title: "Pi took it" },
];

const preview = (text: string) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}\u2026` : flat;
};

/** A button that acts without taking the focus from the reply box. */
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

/**
 * The foot of the page by the character's state. When a questionnaire shown here closes, it says who answered it: the
 * operator here, or someone in its terminal.
 */
export function Footer({
	character,
	onSend,
	goToTerminal,
	terminalProblem,
}: {
	character: Character;
	onSend: () => void;
	goToTerminal: () => void;
	terminalProblem?: string;
}) {
	const asking = character.facts?.asking ?? null;
	const questionnaire = asking?.questionnaire;
	const shown = useRef<string | undefined>(undefined);
	const [note, setNote] = useState<string>();
	useEffect(() => {
		const was = shown.current;
		shown.current = questionnaire?.id;
		if (questionnaire) setNote(undefined);
		else if (was) {
			const mine = conversationPanel
				.sent()
				.some((s) => s.kind === "answer" && s.questionnaire === was && !s.stages.includes("failed"));
			setNote(
				mine
					? `You answered ${character.name}'s question; it carries on.`
					: `${character.name}'s question was answered in its terminal.`,
			);
		}
	}, [questionnaire, character.name]);

	if (questionnaire) return <QuestionForm key={questionnaire.id} character={character} questionnaire={questionnaire} />;
	if (asking)
		return <TerminalOnly character={character} asking={asking} goToTerminal={goToTerminal} problem={terminalProblem} />;
	return (
		<Actions
			character={character}
			note={note}
			onSend={() => {
				setNote(undefined);
				onSend();
			}}
		/>
	);
}

export function Actions({ character, note, onSend }: { character: Character; note?: string; onSend: () => void }) {
	const busy = (character.facts?.run ?? "idle") !== "idle";
	const [text, setText] = useState(() => conversationPanel.draft(character.id));
	const [confirming, setConfirming] = useState(false);
	const box = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const el = box.current;
		if (!el) return;
		el.focus({ preventScroll: true });
		el.setSelectionRange(el.value.length, el.value.length);
	}, []);
	// Stopping is offered only while it works; a confirmation left open closes when it settles by itself.
	useEffect(() => {
		if (!busy) setConfirming(false);
	}, [busy]);

	const change = (value: string) => {
		setText(value);
		conversationPanel.setDraft(character.id, value);
	};

	const send = (kind: "talk" | "steer" | "follow_up") => {
		const words = text;
		if (!words.trim()) return;
		change("");
		onSend();
		box.current?.focus();
		void conversationPanel.instruct(character, { kind, text: words }).then((ok) => {
			// Not taken (say it became busy meanwhile): the words come back to the box, unless it holds new ones.
			if (!ok && !conversationPanel.draft(character.id)) {
				conversationPanel.setDraft(character.id, words);
				setText((now) => now || words);
			}
		});
	};

	const stop = () => {
		setConfirming(false);
		void conversationPanel.instruct(character, { kind: "abort", confirmed: true });
		box.current?.focus();
	};

	const rows = Math.min(MAX_ROWS, Math.max(2, text.split("\n").length));
	const empty = !text.trim();

	return (
		<footer className={`aw-conv-act${busy ? " aw-conv-act-busy" : ""}`}>
			{note && (
				<p className="aw-conv-closed" role="status">
					{note}
				</p>
			)}
			<Receipts characterId={character.id} />
			<div className="aw-conv-box">
				<span className="aw-quill" aria-hidden="true" />
				<textarea
					ref={box}
					className="aw-conv-input"
					aria-label={busy ? `Instruct ${character.name}` : `Reply to ${character.name}`}
					placeholder={
						busy
							? `Redirect ${character.name} now, or tell it after this turn\u2026`
							: `Reply to ${character.name}\u2026`
					}
					rows={rows}
					value={text}
					onChange={(event) => change(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
						event.preventDefault();
						send(busy ? "steer" : "talk");
					}}
				/>
			</div>
			<div className="aw-conv-act-bar">
				<span className="aw-conv-hint">
					<kbd>Enter</kbd> {busy ? "redirects now" : "sends"} &middot; <kbd>Shift</kbd>+<kbd>Enter</kbd> new line
				</span>
				{busy ? (
					<>
						<button
							type="button"
							className="aw-plaque aw-plaque-small aw-plaque-wax"
							onMouseDown={keepFocus}
							onClick={() => setConfirming(true)}
						>
							Stop
						</button>
						<button
							type="button"
							className="aw-plaque aw-plaque-small aw-plaque-quiet"
							disabled={empty}
							onMouseDown={keepFocus}
							onClick={() => send("follow_up")}
						>
							Tell it after this
						</button>
						<button
							type="button"
							className="aw-plaque aw-plaque-small"
							disabled={empty}
							onMouseDown={keepFocus}
							onClick={() => send("steer")}
						>
							Redirect now
						</button>
					</>
				) : (
					<button
						type="button"
						className="aw-plaque aw-plaque-small"
						disabled={empty}
						onMouseDown={keepFocus}
						onClick={() => send("talk")}
					>
						Reply
					</button>
				)}
			</div>
			{confirming && (
				<ConfirmStop
					character={character}
					onStop={stop}
					onKeep={() => {
						setConfirming(false);
						box.current?.focus();
					}}
				/>
			)}
		</footer>
	);
}

/** Stopping a busy agent asks first; declining sends nothing. */
function ConfirmStop({ character, onStop, onKeep }: { character: Character; onStop: () => void; onKeep: () => void }) {
	const keep = useRef<HTMLButtonElement>(null);
	const keepNow = useRef(onKeep);
	keepNow.current = onKeep;
	useEffect(() => {
		keep.current?.focus();
		return conversationPanel.onEscape(() => keepNow.current());
	}, []);
	const doing = activity(character);
	return (
		<div className="aw-conv-confirm" role="alertdialog" aria-modal="true" aria-label={`Stop ${character.name}?`}>
			<span className="aw-conv-confirm-seal" aria-hidden="true" />
			<p className="aw-conv-confirm-title">Stop {character.name}?</p>
			<p className="aw-conv-confirm-text">
				It is busy{doing && doing !== "Working" ? <> &mdash; {doing}</> : null}. Its turn ends where it stands; what it
				has written so far stays in the transcript.
			</p>
			<div className="aw-conv-confirm-bar">
				<button ref={keep} type="button" className="aw-plaque aw-plaque-small aw-plaque-quiet" onClick={onKeep}>
					Let it work
				</button>
				<button type="button" className="aw-plaque aw-plaque-small aw-plaque-wax" onClick={onStop}>
					Stop it
				</button>
			</div>
		</div>
	);
}

/** The latest instructions sent to this character and how far each got. */
export function Receipts({ characterId, kinds }: { characterId: string; kinds?: Instruction["kind"][] }) {
	const sent = useSyncExternalStore(conversationPanel.subscribeSent, conversationPanel.sent);
	const mine = sent.filter((s) => s.characterId === characterId && (!kinds || kinds.includes(s.kind)));
	if (!mine.length) return null;
	return (
		<ol className="aw-conv-receipts" aria-label="Sent">
			{mine.map((s) => (
				<ReceiptLine key={s.commandId} sent={s} />
			))}
		</ol>
	);
}

function ReceiptLine({ sent }: { sent: Sent }) {
	const failed = sent.stages.includes("failed");
	const applied = sent.stages.includes("applied");
	const state = failed ? "failed" : applied ? "applied" : "pending";
	return (
		<li className={`aw-conv-receipt aw-conv-receipt-${state}`} data-command={sent.commandId} data-stage={state}>
			<span className="aw-conv-receipt-what">{LABEL[sent.kind]}</span>
			{sent.text && <q className="aw-conv-receipt-text">{preview(sent.text)}</q>}
			{failed ? (
				<span className="aw-conv-receipt-failed" role="status">
					Failed: {sent.reason ?? "no reason given"}
				</span>
			) : (
				<span className="aw-conv-stages">
					{STAGES.map(({ stage, label, title }) => (
						<span
							key={stage}
							className={`aw-conv-stage${sent.stages.includes(stage) || applied ? " aw-on" : ""}`}
							title={title}
						>
							{label}
						</span>
					))}
				</span>
			)}
		</li>
	);
}

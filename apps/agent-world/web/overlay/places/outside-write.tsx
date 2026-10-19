// Writing outside as the operator (decision 13), for every function place: a pull request review, a Jira comment or
// move, a Slack reply. `useOutsideWrite` asks the backend's gate to describe the write (nothing is sent), shows the
// description in `ConfirmWrite` (what is done, where, and the exact text), and sends it only when the operator confirms,
// with the token the gate gave for that same write. Declining sends nothing. Each sent write reaches the chatbox (the
// gate announces it; the answer is shown too, once) and the gate's append-only local record.
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	IntegrationsApi,
	OutsideWriteEntry,
	OutsideWriteIntent,
	Refusal,
	WriteDescription,
} from "../../../src/integrations.js";
import { chatLines } from "../interface/chat-lines.js";
import { dialogLayer } from "./place-dialog.js";

export type WriteApi = Pick<IntegrationsApi, "describeWrite" | "confirmWrite">;

/** Where a write is: being described, waiting for the operator, being sent, sent, or refused or failed with why. */
export type WriteState =
	| { phase: "idle" }
	| { phase: "describing"; intent: OutsideWriteIntent }
	| { phase: "confirming"; intent: OutsideWriteIntent; token: string; description: WriteDescription }
	| { phase: "sending"; intent: OutsideWriteIntent; token: string; description: WriteDescription }
	| { phase: "sent"; intent: OutsideWriteIntent; entry: OutsideWriteEntry }
	| { phase: "failed"; intent: OutsideWriteIntent; reason: string; signIn?: Refusal["signIn"] };

const failure = (error: unknown) => String((error as Error)?.message ?? error);

/** One outside write at a time, from asking through confirming to its result. */
export function useOutsideWrite(api: WriteApi | undefined) {
	const [state, setState] = useState<WriteState>({ phase: "idle" });
	const current = useRef(state);
	current.current = state;
	const alive = useRef(true);
	useEffect(
		() => () => {
			alive.current = false;
		},
		[],
	);
	const set = useCallback((next: WriteState) => {
		current.current = next;
		if (alive.current) setState(next);
	}, []);

	/** Ask the gate to describe the write; the operator then confirms or declines it. Nothing is sent yet. */
	const ask = useCallback(
		async (intent: OutsideWriteIntent) => {
			if (!api) return set({ phase: "failed", intent, reason: "Agent World is not connected." });
			set({ phase: "describing", intent });
			try {
				const described = await api.describeWrite(intent);
				if (current.current.phase !== "describing") return; // declined meanwhile
				if (!described.ok) return set({ phase: "failed", intent, reason: described.reason, signIn: described.signIn });
				set({ phase: "confirming", intent, token: described.token, description: described.description });
			} catch (error) {
				set({ phase: "failed", intent, reason: failure(error) });
			}
		},
		[api, set],
	);

	/** Send the write the operator saw, exactly as described. */
	const confirm = useCallback(async () => {
		const asked = current.current;
		if (asked.phase !== "confirming" || !api) return;
		set({ ...asked, phase: "sending" });
		try {
			const result = await api.confirmWrite(asked.intent, asked.token);
			if (result.ok) {
				chatLines.write(result.entry);
				set({ phase: "sent", intent: asked.intent, entry: result.entry });
			} else set({ phase: "failed", intent: asked.intent, reason: result.reason, signIn: result.signIn });
		} catch (error) {
			set({ phase: "failed", intent: asked.intent, reason: failure(error) });
		}
	}, [api, set]);

	/** Decline (nothing is sent), or put a result away. */
	const cancel = useCallback(() => {
		if (current.current.phase !== "sending") set({ phase: "idle" });
	}, [set]);

	return { state, ask, confirm, cancel };
}

/** True while the confirmation shows: described and waiting, or being sent. */
export const confirming = (state: WriteState) => state.phase === "confirming" || state.phase === "sending";

/**
 * The confirmation, over the panel that asked: what is done, where, the exact text, and two buttons, the safe one
 * focused. Render it inside the place's `PlaceDialog`, with the rest of the panel `inert` while it shows, so Tab and
 * clicks stay here; Escape, the panel's close button, or a click on the world decline it and leave the panel open.
 */
export function ConfirmWrite({
	state,
	onConfirm,
	onCancel,
}: {
	state: Extract<WriteState, { phase: "confirming" | "sending" }>;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const keep = useRef<HTMLButtonElement>(null);
	const decline = useRef(onCancel);
	decline.current = onCancel;
	useEffect(() => dialogLayer(() => decline.current()), []);
	useEffect(() => {
		const before = document.activeElement;
		keep.current?.focus({ preventScroll: true });
		return () => {
			if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
		};
	}, []);
	const { description } = state;
	const sending = state.phase === "sending";
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking beside the confirmation declines; Escape does from the keyboard
		<div
			className="aw-write-veil"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !sending) onCancel();
			}}
		>
			<div
				className="aw-write-confirm aw-surface"
				role="alertdialog"
				aria-modal="true"
				aria-label={`${description.what}?`}
				aria-describedby="aw-write-where aw-write-note"
			>
				<span className="aw-confirm-mark" aria-hidden="true" />
				<h2>{description.what}?</h2>
				<dl className="aw-write-facts">
					<div>
						<dt>Where</dt>
						<dd id="aw-write-where">{description.where}</dd>
					</div>
					<div>
						<dt>As</dt>
						<dd>You, under your own name</dd>
					</div>
				</dl>
				{description.text ? (
					<blockquote className="aw-write-text" aria-label="Exactly what is sent">
						{description.text}
					</blockquote>
				) : (
					<p className="aw-write-text aw-write-none">No text: only the {description.what.toLowerCase()} itself.</p>
				)}
				<p id="aw-write-note" className="aw-write-note">
					Nothing is sent until you choose Send. It is then logged in the chatbox and in your local record.
				</p>
				<div className="aw-write-actions">
					<button ref={keep} type="button" className="aw-button" disabled={sending} onClick={onCancel}>
						Don&rsquo;t send
					</button>
					<button type="button" className="aw-button aw-button-strong" disabled={sending} onClick={onConfirm}>
						{sending ? "Sending\u2026" : "Send as you"}
					</button>
				</div>
			</div>
		</div>
	);
}

// A write outside as the operator (a Jira comment or move), confirmed before anything is sent (decision 13): the
// backend's gate describes exactly what goes where and issues a token for that one write; only "Send as you" passes the
// token back, and the gate refuses anything else. Shown over the place's panel; Cancel (the default) sends nothing.
import { useEffect, useRef, useState } from "react";
import type { OutsideWriteIntent, WriteDescription, WriteResult } from "../../../src/integrations.js";
import { trapTab } from "../focus.js";
import { atlassian } from "./atlassian-state.js";

type Step =
	| { state: "describing" }
	| { state: "confirm"; token: string; description: WriteDescription }
	| { state: "sending"; description: WriteDescription }
	| { state: "refused"; reason: string; signIn?: boolean };

const failure = (error: unknown) => String((error as Error)?.message ?? error);

export function GatedWrite({
	intent,
	verb,
	onCancel,
	onSent,
}: {
	intent: OutsideWriteIntent;
	/** What the send button says ("Comment as you", "Move it"). */
	verb: string;
	onCancel: () => void;
	/** Sent (or tried, and Jira said no): the gate's result, already logged. */
	onSent: (result: WriteResult) => void;
}) {
	const [step, setStep] = useState<Step>({ state: "describing" });
	const cancel = useRef<HTMLButtonElement>(null);
	const box = useRef<HTMLDivElement>(null);
	const who = atlassian.get().signedIn?.email;

	useEffect(() => {
		let live = true;
		const { api } = atlassian.get();
		void (async () => {
			try {
				if (!api?.describeWrite) throw new Error("Agent World is not connected.");
				const described = await api.describeWrite(intent);
				if (!live) return;
				setStep(
					described.ok
						? { state: "confirm", token: described.token, description: described.description }
						: { state: "refused", reason: described.reason, signIn: described.signIn === "atlassian" },
				);
			} catch (error) {
				if (live) setStep({ state: "refused", reason: failure(error) });
			}
		})();
		return () => {
			live = false;
		};
	}, [intent]);

	useEffect(() => {
		if (step.state === "confirm" || step.state === "refused") cancel.current?.focus({ preventScroll: true });
	}, [step.state]);

	// Escape (or the panel's close button) cancels the confirmation, not the panel under it.
	const cancelRef = useRef(onCancel);
	cancelRef.current = onCancel;
	useEffect(() => atlassian.layer(() => cancelRef.current()), []);

	// Tab stays inside the confirmation while it is open.
	useEffect(() => {
		const keep = (event: KeyboardEvent) => {
			if (trapTab(event, box.current)) event.stopImmediatePropagation();
		};
		window.addEventListener("keydown", keep, { capture: true });
		return () => window.removeEventListener("keydown", keep, { capture: true });
	}, []);

	const send = async () => {
		if (step.state !== "confirm") return;
		const { api } = atlassian.get();
		setStep({ state: "sending", description: step.description });
		try {
			if (!api?.confirmWrite) throw new Error("Agent World is not connected.");
			onSent(await api.confirmWrite(intent, step.token));
		} catch (error) {
			onSent({ ok: false, reason: failure(error) });
		}
	};

	const description = step.state === "confirm" || step.state === "sending" ? step.description : undefined;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking beside the note cancels; Escape does from the keyboard
		<div
			className="aw-gate-veil"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && step.state !== "sending") onCancel();
			}}
		>
			<div
				ref={box}
				className="aw-frame aw-gate"
				role="alertdialog"
				aria-modal="true"
				aria-label={description ? `${description.what}?` : "Checking what would be sent"}
			>
				<div className="aw-gate-body aw-surface">
					<span className="aw-gate-mark" aria-hidden="true" />
					{step.state === "describing" && (
						<p className="aw-progress aw-progress-sending" role="status">
							Checking exactly what would be sent&hellip;
						</p>
					)}
					{step.state === "refused" && (
						<>
							<h2>Nothing was sent</h2>
							<p className="aw-gate-reason" role="alert">
								{step.reason}
							</p>
							<div className="aw-gate-actions">
								{step.signIn && (
									<button type="button" className="aw-button" onClick={() => atlassian.askSignIn()}>
										Sign in from Settings
									</button>
								)}
								<button ref={cancel} type="button" className="aw-button aw-button-strong" onClick={onCancel}>
									Back
								</button>
							</div>
						</>
					)}
					{description && (
						<>
							<h2>{description.what}?</h2>
							<dl className="aw-gate-facts">
								<dt>Where</dt>
								<dd>{description.where}</dd>
								<dt>As</dt>
								<dd>{who ? `You (${who})` : "You"}</dd>
							</dl>
							<blockquote className="aw-gate-text" aria-label="Exactly what is sent">
								{description.text}
							</blockquote>
							<p className="aw-gate-note">It goes as you, and is logged in the chatbox and your local record.</p>
							<div className="aw-gate-actions">
								<button
									ref={cancel}
									type="button"
									className="aw-button"
									disabled={step.state === "sending"}
									onClick={onCancel}
								>
									Cancel
								</button>
								<button
									type="button"
									className="aw-button aw-button-strong"
									disabled={step.state === "sending"}
									onClick={() => void send()}
								>
									{step.state === "sending" ? "Sending\u2026" : verb}
								</button>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

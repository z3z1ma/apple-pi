// Delegating from the quest office and the library (decision 25): the operator asks an agent to work on an issue or a
// page. It is an ordinary instruction (a `talk`, or a `follow_up` to a busy agent) naming the item; nothing is written
// to Jira or Confluence. Its receipts (sent, delivered, applied) show where he asked, and the chatbox notes it.
import { useEffect, useRef, useState } from "react";
import type { DelegationAsk, DelegationItem } from "../../../src/integrations.js";
import type { Character, WorldSnapshot } from "../../../src/world.js";
import { chatLines } from "../interface/chat-lines.js";
import { atlassian } from "./atlassian-state.js";
import type { Progress } from "./place-panels.js";

const failure = (error: unknown) => String((error as Error)?.message ?? error);
const commandId = () =>
	typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `aw-${Date.now()}-${Math.random()}`;

/** The awake agents to ask, the coordinators first. */
export function askable(world: WorldSnapshot | undefined): Character[] {
	const awake = world?.characters ?? [];
	return [...awake.filter((c) => c.role === "coordinator"), ...awake.filter((c) => c.role !== "coordinator")];
}

/**
 * Send a delegation and follow its receipts: `onProgress` hears sending, then delivered or applied (done), or why it
 * failed. Resolves once the backend answered.
 */
export async function delegate(
	to: string,
	item: DelegationItem,
	ask: DelegationAsk,
	note: string,
	names: (id: string) => string,
	onProgress: (progress: Progress) => void,
): Promise<void> {
	const { api } = atlassian.get();
	if (!api?.delegate) return onProgress({ state: "failed", text: "Agent World is not connected." });
	const id = commandId();
	let target = to === "coordinator" ? "the coordinator" : names(to);
	const stop = api.onReceipt?.((receipt) => {
		if (receipt.commandId !== id) return;
		target = names(receipt.characterId);
		if (receipt.stage === "failed") onProgress({ state: "failed", text: receipt.reason ?? "It did not reach them." });
		if (receipt.stage === "delivered") onProgress({ state: "done", text: `Delivered to ${target}.` });
		if (receipt.stage === "applied") onProgress({ state: "done", text: `${target} has it.` });
	});
	onProgress({ state: "sending", text: `Sending to ${target}\u2026` });
	try {
		const result = await api.delegate(id, { to, item, ask, ...(note.trim() ? { note: note.trim() } : {}) });
		if (!result.ok) {
			stop?.();
			return onProgress({ state: "failed", text: result.reason });
		}
		target = names(result.to);
		const what = item.kind === "issue" ? item.key : `\u201c${item.kind === "page" ? item.title : ""}\u201d`;
		const verb = { "start-work": "hand", summarise: "ask", update: "ask" }[ask as string] ?? "ask";
		chatLines.add(
			verb === "hand"
				? `You hand ${what} to ${target}.`
				: `You ask ${target} to ${ask === "update" ? "update" : "summarise"} ${what}.`,
			"commands",
		);
		onProgress({
			state: "done",
			text: result.command === "follow_up" ? `${target} is busy; it gets this after its turn.` : `Sent to ${target}.`,
		});
		// Later receipts (delivered, applied) refine the line; stop listening after a while.
		setTimeout(() => stop?.(), 60_000);
	} catch (error) {
		stop?.();
		onProgress({ state: "failed", text: failure(error) });
	}
}

/**
 * The form under an issue or a page: whom to ask (the coordinator for an issue; any awake agent for a page), what to
 * ask (for a page: summarise or update), and a note in the operator's own words.
 */
export function HandOver({
	world,
	item,
	asks,
	fixedTo,
	title,
	hint,
	onClose,
}: {
	world: WorldSnapshot | undefined;
	item: DelegationItem;
	/** What may be asked, the first chosen. */
	asks: { ask: DelegationAsk; label: string }[];
	/** Always this agent (`coordinator`); otherwise the operator picks one. */
	fixedTo?: "coordinator";
	title: string;
	hint: string;
	onClose: () => void;
}) {
	const agents = askable(world);
	const [to, setTo] = useState<string>(fixedTo ?? agents[0]?.id ?? "");
	const [ask, setAsk] = useState<DelegationAsk>(asks[0].ask);
	const [note, setNote] = useState("");
	const [progress, setProgress] = useState<Progress>();
	const field = useRef<HTMLTextAreaElement>(null);
	useEffect(() => field.current?.focus({ preventScroll: true }), []);
	const names = (id: string) => world?.characters.find((c) => c.id === id)?.name ?? id;
	const coordinator = agents.find((c) => c.role === "coordinator");
	const nobody = fixedTo ? !coordinator : agents.length === 0;

	const send = () => {
		if (!to || progress?.state === "sending") return;
		void delegate(to, item, ask, note, names, setProgress);
	};

	return (
		<form
			className="aw-hand"
			aria-label={title}
			onSubmit={(event) => {
				event.preventDefault();
				send();
			}}
		>
			<div className="aw-hand-head">
				<h3>{title}</h3>
				<p className="aw-hand-hint">{hint}</p>
			</div>
			{!fixedTo && (
				<div className="aw-hand-choices">
					<label className="aw-hand-to">
						<span>Ask</span>
						<select aria-label="Which agent" value={to} onChange={(event) => setTo(event.target.value)}>
							{agents.map((agent) => (
								<option key={agent.id} value={agent.id}>
									{agent.role === "coordinator" ? `${agent.name} (coordinator)` : agent.name}
								</option>
							))}
						</select>
					</label>
					{asks.length > 1 && (
						<fieldset className="aw-hand-asks">
							<legend>To</legend>
							{asks.map((choice) => (
								<label key={choice.ask} className="aw-hand-ask">
									<input
										type="radio"
										name="aw-hand-ask"
										value={choice.ask}
										checked={ask === choice.ask}
										onChange={() => setAsk(choice.ask)}
									/>
									<span>{choice.label}</span>
								</label>
							))}
						</fieldset>
					)}
				</div>
			)}
			{fixedTo && coordinator && (
				<p className="aw-hand-who">
					To <strong>{coordinator.name}</strong>, your coordinator
				</p>
			)}
			<textarea
				ref={field}
				className="aw-hand-note"
				aria-label="Your note (optional)"
				placeholder="Anything to add? (optional)"
				rows={3}
				value={note}
				onChange={(event) => setNote(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
				}}
			/>
			{nobody && (
				<p className="aw-progress aw-progress-failed" role="status">
					{fixedTo ? "No coordinator is awake to hand it to." : "No agent is awake to ask."}
				</p>
			)}
			<div className="aw-hand-actions">
				{progress && (
					<span className={`aw-progress aw-progress-${progress.state}`} role="status">
						{progress.text}
					</span>
				)}
				<button type="button" className="aw-button" onClick={onClose}>
					{progress?.state === "done" ? "Done" : "Cancel"}
				</button>
				{progress?.state !== "done" && (
					<button
						type="submit"
						className="aw-button aw-button-strong"
						disabled={nobody || progress?.state === "sending"}
					>
						{fixedTo ? "Hand it over" : "Ask"}
					</button>
				)}
			</div>
		</form>
	);
}

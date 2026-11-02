import { useEffect, useId, useRef, useState } from "react";
import type { RetirePeopleProgress, RetirePeopleRequest, RetirePersonProgress } from "../src/departures.js";
import "./workplace-departures.css";

export interface DepartureSelection {
	id: string;
	people: { person: string; name: string; manager: boolean }[];
	trigger: HTMLElement;
}

const labels: Record<RetirePersonProgress["state"], string> = {
	pending: "Not started",
	accepted: "Accepted; handoff or cleanup pending",
	delivered: "Departure committed; cleanup pending",
	applied: "Removed",
	failed: "Refused or failed",
	blocked: "Not sent",
	uncertain: "Outcome unknown",
};

export function DepartureDialog({
	selection,
	open,
	connected,
	onHide,
	onClose,
	onUnsettled,
}: {
	selection: DepartureSelection;
	open: boolean;
	connected: boolean;
	onHide: () => void;
	onClose: () => void;
	onUnsettled: (value: boolean) => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const lock = useRef(false);
	const title = useId();
	const [reason, setReason] = useState("");
	const [mode, setMode] = useState("all");
	const [permanent, setPermanent] = useState(false);
	const [request, setRequest] = useState<RetirePeopleRequest>();
	const [progress, setProgress] = useState<RetirePeopleProgress>();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const unknown = !!error || progress?.people.some((person) => person.state === "uncertain");
	const frozen = !!request;
	const handoff = (person: DepartureSelection["people"][number]) =>
		mode === "all" || (mode === "managers" && person.manager);
	useEffect(() => {
		const element = dialog.current!;
		if (open) {
			element.showModal();
			cancel.current?.focus();
		} else element.close();
		return () => {
			element.close();
			if (selection.trigger.isConnected) selection.trigger.focus({ preventScroll: true });
		};
	}, [open, selection]);
	useEffect(
		() =>
			window.agentWorld.onRetirePeople((next) => {
				if (next.id === selection.id) setProgress(next);
			}),
		[selection.id],
	);
	useEffect(() => {
		onUnsettled(pending || !!unknown);
	}, [pending, unknown, onUnsettled]);
	useEffect(() => () => onUnsettled(false), [onUnsettled]);
	useEffect(() => {
		if (!open) return;
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			onHide();
		};
		window.addEventListener("keydown", onEscape, true);
		return () => window.removeEventListener("keydown", onEscape, true);
	}, [open, onHide]);
	async function submit() {
		if (lock.current || !connected || (!request && (!reason.trim() || !permanent))) return;
		const confirmed = request ?? {
			id: selection.id,
			reason: reason.trim(),
			people: selection.people.map((person) => ({ person: person.person, handoff: handoff(person) })),
		};
		lock.current = true;
		setRequest(confirmed);
		setPending(true);
		setError(undefined);
		try {
			setProgress(await window.agentWorld.retirePeople(confirmed));
		} catch (error) {
			setError(`Outcome unknown: ${String(error)}. Check this same request before making a new selection.`);
		} finally {
			lock.current = false;
			setPending(false);
		}
	}
	return (
		<dialog
			ref={dialog}
			className="wp-person-dialog wp-departures"
			aria-labelledby={title}
			aria-busy={pending}
			onCancel={(event) => {
				event.preventDefault();
				onHide();
			}}
		>
			<h2 id={title}>Let {selection.people.length} people go</h2>
			<div className="wp-departure-body">
				<p>
					Remove only these people and their private resources permanently. Current turns can be stopped. Unfinished
					work, unselected reports and active delegations can block removal.
				</p>
				<p>
					Selected reports leave before managers. Each departure must finish cleanup before its manager starts. No work
					is reassigned and no extra people are added.
				</p>
				<fieldset disabled={frozen}>
					<legend>Request final handoffs</legend>
					{[
						{ value: "all", name: "All selected people" },
						{ value: "managers", name: "Managers only" },
						{ value: "none", name: "None" },
					].map((choice) => (
						<label key={choice.value} className="wp-person-permanent">
							<input
								type="radio"
								name={title}
								value={choice.value}
								checked={mode === choice.value}
								onChange={() => setMode(choice.value)}
							/>
							{choice.name}
						</label>
					))}
				</fieldset>
				<p>
					{mode === "managers"
						? "Managers have a managing role or current reports when this preview opens. The list below shows each choice."
						: mode === "none"
							? "No final model turns or handoff files; people who are away stay away until removal."
							: "Each selected person writes a final handoff, waking first if needed."}
				</p>
				<div className="wp-departure-list">
					<table aria-label="Selected departures">
						<thead>
							<tr>
								<th>Person</th>
								<th>Handoff</th>
								<th>Outcome</th>
							</tr>
						</thead>
						<tbody>
							{selection.people.map((person) => {
								const outcome = progress?.people.find((item) => item.person === person.person);
								return (
									<tr key={person.person}>
										<th scope="row">{person.name}</th>
										<td>{handoff(person) ? "Requested" : "None"}</td>
										<td>
											{outcome ? labels[outcome.state] : "Not started"}
											{outcome?.reason && <p>{outcome.reason}</p>}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				<label>
					Reason for leaving
					<textarea
						aria-label="Reason for leaving"
						rows={2}
						value={reason}
						disabled={frozen}
						onChange={(event) => setReason(event.target.value)}
					/>
				</label>
				<label className="wp-person-permanent">
					<input
						type="checkbox"
						checked={permanent}
						disabled={frozen}
						onChange={(event) => setPermanent(event.target.checked)}
					/>
					Permanently remove these {selection.people.length} people
				</label>
				{error && <p role="alert">{error}</p>}
				{!connected && <p role="alert">The runtime is disconnected. Issued departures may still be running.</p>}
				<p>
					Keep the app open while the batch runs. Hide keeps progress available here; quitting stops unsent requests,
					while accepted departures continue in the runtime.
				</p>
				{progress?.finished && (
					<p role="status">
						{progress.people.filter((person) => person.state === "applied").length} of {selection.people.length}{" "}
						removed. Each result is shown above.
					</p>
				)}
			</div>
			<footer>
				<button type="button" ref={cancel} onClick={pending || unknown ? onHide : onClose}>
					{pending || unknown ? "Hide" : frozen ? "Close" : "Cancel"}
				</button>
				{(!frozen || unknown) && (
					<button
						type="button"
						className="wp-person-confirm"
						disabled={pending || !connected || (!frozen && (!reason.trim() || !permanent))}
						onClick={() => void submit()}
					>
						{frozen ? "Check and continue" : "Let go"}
					</button>
				)}
			</footer>
		</dialog>
	);
}

import { useEffect, useId, useRef, useState } from "react";
import { NAME_MAX, type RoleChoice, type WorldSnapshot } from "../src/world.js";
import "./workplace-add-person.css";

export function AddPerson({
	world,
	manager,
	onClose,
	onCreated,
	onBusyChange,
}: {
	world: WorldSnapshot;
	manager: string;
	onClose: () => void;
	onCreated: (id: string) => void;
	onBusyChange?: (busy: boolean) => void;
}) {
	const api = window.agentWorld;
	const id = useId();
	const [roles, setRoles] = useState<RoleChoice[]>([]);
	const [role, setRole] = useState("");
	const [name, setName] = useState("");
	const person = world.characters.find((candidate) => candidate.id === manager);
	const [cwd, setCwd] = useState(person?.facts?.cwd ?? "");
	const [goal, setGoal] = useState("");
	const [specialization, setSpecialization] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState<{ id: string; note: string }>();
	const close = useRef<HTMLButtonElement>(null);
	const completed = useRef(false);
	const selected = roles.find((choice) => choice.name === role);
	const canManage =
		!!person &&
		!person.facts?.temporary &&
		((!person.facts?.title && !person.facts?.reportsTo) ||
			roles.some((choice) => choice.title === person.facts?.title && choice.manages));

	useEffect(() => {
		close.current?.focus();
		let current = true;
		void api
			.roles()
			.then((choices) => {
				if (!current) return;
				setRoles(choices);
				setRole(choices.find((choice) => !choice.manages)?.name ?? choices[0]?.name ?? "");
			})
			.catch((reason) => {
				if (current) setError(String(reason));
			});
		return () => {
			current = false;
		};
	}, []);

	useEffect(() => {
		if (!pending || completed.current || !world.characters.some((candidate) => candidate.id === pending.id)) return;
		completed.current = true;
		onCreated(pending.id);
	}, [world.characters, pending, onCreated]);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (busy || pending || !canManage || !selected || !cwd.trim() || !goal.trim()) return;
		setBusy(true);
		onBusyChange?.(true);
		setError(undefined);
		try {
			const receipt = await api.recruit({
				name: name.trim(),
				cwd: cwd.trim(),
				brief: goal.trim(),
				reportsTo: manager,
				role,
				...(specialization.trim() ? { specialization: specialization.trim() } : {}),
			});
			if (!receipt.ok) {
				if (receipt.sessionId) {
					setPending({
						id: receipt.sessionId,
						note: `${receipt.reason} Check this person's state before starting another person.`,
					});
				} else setError(receipt.reason);
			} else if (receipt.stage === "applied" && receipt.sessionId) {
				completed.current = true;
				onCreated(receipt.sessionId);
			} else {
				setPending({
					id: receipt.sessionId ?? "",
					note:
						receipt.note ??
						"The start was accepted, but the person has not joined yet. Check the team before starting another person.",
				});
			}
		} catch (reason) {
			setPending({
				id: "",
				note: `The start could not be confirmed: ${String(reason)}. Check the team before starting another person.`,
			});
		} finally {
			setBusy(false);
			onBusyChange?.(false);
		}
	}

	return (
		<aside className="wp-add-person" aria-label="Add person">
			<header>
				<div>
					<h2>Add person</h2>
					<p>Reports to {person?.name ?? "unavailable manager"}</p>
				</div>
				<button type="button" ref={close} onClick={onClose} disabled={busy} aria-label="Close add person">
					Close
				</button>
			</header>
			<form onSubmit={submit} aria-busy={busy}>
				<p>This starts a Pi session immediately with the role and goal below.</p>
				<fieldset disabled={busy || !!pending}>
					<label htmlFor={`${id}-role`}>Role</label>
					<select id={`${id}-role`} value={role} required onChange={(event) => setRole(event.target.value)}>
						{!roles.length && <option value="">Loading roles...</option>}
						{roles.map((choice) => (
							<option key={choice.name} value={choice.name}>
								{choice.title}
							</option>
						))}
					</select>
					{selected && (
						<div className="wp-add-person-mandate">
							<p>{selected.mandate}</p>
							<p>
								{selected.manages ? "Manages people" : "Individual contributor"} /{" "}
								{selected.writes ? "Writes" : "Advises (read-only)"}
							</p>
						</div>
					)}
					<label htmlFor={`${id}-specialization`}>Specialization</label>
					<textarea
						id={`${id}-specialization`}
						className="wp-specialization"
						value={specialization}
						rows={2}
						aria-describedby={`${id}-specialization-help`}
						placeholder="Focus on keyboard and screen-reader behavior."
						onChange={(event) => setSpecialization(event.target.value)}
					/>
					<p id={`${id}-specialization-help`}>A focus within this role. All role responsibilities still apply.</p>
					<label htmlFor={`${id}-name`}>Name (optional)</label>
					<input
						id={`${id}-name`}
						value={name}
						maxLength={NAME_MAX}
						placeholder="Assigned automatically when blank"
						onChange={(event) => setName(event.target.value)}
					/>
					<label htmlFor={`${id}-cwd`}>Repository</label>
					<input
						id={`${id}-cwd`}
						value={cwd}
						required
						placeholder="/full/path/to/repository"
						onChange={(event) => setCwd(event.target.value)}
					/>
					<label htmlFor={`${id}-goal`}>Goal</label>
					<textarea
						id={`${id}-goal`}
						value={goal}
						required
						rows={6}
						onChange={(event) => setGoal(event.target.value)}
					/>
				</fieldset>
				{roles.length > 0 && !canManage && <p role="alert">Choose a running manager who can manage people.</p>}
				{error && <p role="alert">{error}</p>}
				{busy && <p role="status">Starting person...</p>}
				{pending && (
					<p role="status">
						{pending.note}
						{pending.id ? ` Session: ${pending.id}` : ""}
					</p>
				)}
				<footer>
					<button type="button" onClick={onClose} disabled={busy}>
						Cancel
					</button>
					<button
						className="wp-org-primary"
						type="submit"
						disabled={busy || !!pending || !canManage || !selected || !cwd.trim() || !goal.trim()}
					>
						Add person
					</button>
				</footer>
			</form>
		</aside>
	);
}

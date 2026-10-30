import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { WorldSnapshot } from "../src/world.js";
import "./workplace-communications.css";

export function CommunicationDialog({
	title,
	busy,
	close,
	children,
}: {
	title: string;
	busy: boolean;
	close: () => void;
	children: ReactNode;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const heading = useId();
	useEffect(() => {
		const element = dialog.current!;
		const trigger = document.activeElement;
		element.showModal();
		return () => {
			element.close();
			if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
		};
	}, []);
	useEffect(() => {
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!busy) close();
		};
		window.addEventListener("keydown", onEscape, { capture: true });
		return () => window.removeEventListener("keydown", onEscape, { capture: true });
	}, [busy, close]);
	return (
		<dialog
			ref={dialog}
			className="wp-communication-dialog"
			aria-labelledby={heading}
			aria-busy={busy}
			onCancel={(event) => {
				event.preventDefault();
				if (!busy) close();
			}}
		>
			<header>
				<h2 id={heading}>{title}</h2>
				<button type="button" disabled={busy} onClick={close}>
					Close
				</button>
			</header>
			{children}
		</dialog>
	);
}

export function CommunicationRecipients({
	world,
	label,
	value,
	onChange,
	candidates,
	disabled = false,
}: {
	world: WorldSnapshot;
	label: string;
	value: string[];
	onChange: (people: string[]) => void;
	candidates?: { id: string; name: string }[];
	disabled?: boolean;
}) {
	const [address, setAddress] = useState("");
	const suggestions = useId();
	const people = candidates ?? [...world.characters, ...(world.dormant ?? []).filter((person) => !person.retiredAt)];
	const add = () => {
		const id = address.trim();
		if (!id) return;
		if (!value.includes(id)) onChange([...value, id]);
		setAddress("");
	};
	return (
		<fieldset className="wp-communication-recipients" disabled={disabled}>
			<legend>{label}</legend>
			<div className="wp-communication-address">
				<input
					aria-label={`${label}: person`}
					list={suggestions}
					placeholder="Choose a person or enter a known ID"
					value={address}
					onChange={(event) => setAddress(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							event.stopPropagation();
							add();
						}
					}}
				/>
				<datalist id={suggestions}>
					{people.map((person) => (
						<option key={person.id} value={person.id}>
							{person.name}
						</option>
					))}
				</datalist>
				<button type="button" disabled={disabled || !address.trim()} onClick={add}>
					Add
				</button>
			</div>
			{value.length > 0 && (
				<ul>
					{value.map((id) => (
						<li key={id}>
							<span>{people.find((person) => person.id === id)?.name ?? id}</span>
							<button
								type="button"
								aria-label={`Remove ${label.toLowerCase()}: ${id}`}
								onClick={() => onChange(value.filter((person) => person !== id))}
							>
								Remove
							</button>
						</li>
					))}
				</ul>
			)}
		</fieldset>
	);
}

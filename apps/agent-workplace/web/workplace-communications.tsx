import { type ReactNode, useEffect, useId, useRef } from "react";
import type { WorldSnapshot } from "../src/world.js";
import { Recipients } from "./workplace-fields.js";
import { Icon } from "./workplace-icon.js";
import "./workplace-communications.css";

export function CommunicationDialog({
	title,
	busy,
	close,
	children,
	wide = false,
}: {
	title: string;
	busy: boolean;
	close: () => void;
	children: ReactNode;
	/** Room for a list, such as channel discovery. */
	wide?: boolean;
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
			// An open list inside the dialog closes first, as in any app.
			if (dialog.current?.querySelector('[aria-expanded="true"]')) return;
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
			className="wp-modal wp-communication-dialog"
			data-wide={wide || undefined}
			aria-labelledby={heading}
			aria-busy={busy}
			onCancel={(event) => {
				event.preventDefault();
				if (!busy && !dialog.current?.querySelector('[aria-expanded="true"]')) close();
			}}
		>
			<header className="wp-modal-header">
				<h2 id={heading}>{title}</h2>
				<button type="button" className="wp-modal-close" aria-label="Close" disabled={busy} onClick={close}>
					<Icon name="close" />
				</button>
			</header>
			<div className="wp-modal-body">{children}</div>
		</dialog>
	);
}

/** People to address in a channel action: chips with typeahead, and a known ID typed in full. */
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
	const people = (
		candidates ?? [...world.characters, ...(world.dormant ?? []).filter((person) => !person.retiredAt)]
	).map((person) => ({ id: person.id, name: person.name }));
	return (
		<Recipients
			label={label}
			people={people}
			chosen={value}
			onChange={onChange}
			disabled={disabled}
			placeholder="Name, or a known ID and Enter"
			free
		/>
	);
}

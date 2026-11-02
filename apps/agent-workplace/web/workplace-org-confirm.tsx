import { useEffect, useId, useRef } from "react";
import "./workplace-org-confirm.css";

export function OrgMoveConfirm({
	name,
	reports,
	manager,
	busy,
	error,
	onCancel,
	onConfirm,
}: {
	name: string;
	reports: number;
	manager?: string;
	busy: boolean;
	error?: string;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const title = useId();
	const description = useId();
	useEffect(() => {
		const element = dialog.current!;
		const trigger = document.activeElement;
		element.showModal();
		cancel.current?.focus();
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
			if (!busy) onCancel();
		};
		window.addEventListener("keydown", onEscape, { capture: true });
		return () => window.removeEventListener("keydown", onEscape, { capture: true });
	}, [busy, onCancel]);
	return (
		<dialog
			ref={dialog}
			className="wp-org-move-dialog"
			aria-labelledby={title}
			aria-describedby={description}
			aria-busy={busy}
			onCancel={(event) => {
				event.preventDefault();
				if (!busy) onCancel();
			}}
		>
			<h2 id={title}>Change reporting?</h2>
			<p>
				Move <strong>{name}</strong> and their {reports} reports{" "}
				{manager ? `under ${manager}` : "into an independent organization"}.
			</p>
			<p id={description}>
				Tasks and running work stay intact. Work that would become separated from its organization must be handed off
				first.
			</p>
			{error && <p role="alert">{error}</p>}
			<div>
				<button ref={cancel} type="button" disabled={busy} onClick={onCancel}>
					Cancel
				</button>
				<button type="button" className="wp-org-primary" disabled={busy} onClick={onConfirm}>
					{busy ? "Applying..." : "Confirm move"}
				</button>
			</div>
		</dialog>
	);
}

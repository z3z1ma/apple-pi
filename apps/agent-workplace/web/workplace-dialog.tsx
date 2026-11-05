import type { ReactNode } from "react";
import "./workplace-dialog.css";

export function WorkplaceDialog({
	title,
	confirm,
	danger,
	disabled,
	focusConfirm,
	wide,
	children,
	onConfirm,
	onCancel,
}: {
	title: string;
	confirm: string;
	danger?: boolean;
	disabled?: boolean;
	focusConfirm?: boolean;
	wide?: boolean;
	children?: ReactNode;
	onConfirm(): void;
	onCancel(): void;
}) {
	return (
		<div className="wp-dialog-scrim">
			<form
				className={`wp-dialog ${wide ? "is-wide" : ""}`}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				onSubmit={(event) => {
					event.preventDefault();
					if (!disabled) onConfirm();
				}}
				onKeyDown={(event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopPropagation();
					onCancel();
				}}
			>
				<h2>{title}</h2>
				{children}
				<div className="wp-dialog-actions">
					<button type="button" onClick={onCancel}>
						Cancel
					</button>
					<button
						type="submit"
						// biome-ignore lint/a11y/noAutofocus: a confirmation dialog exists to take this answer.
						autoFocus={focusConfirm}
						className={danger ? "is-danger" : "is-primary"}
						disabled={disabled}
					>
						{confirm}
					</button>
				</div>
			</form>
		</div>
	);
}

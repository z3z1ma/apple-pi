// The frame every function place's panel opens in: over the dimmed world, carved wood around parchment, closed by
// its button, Escape, or a click on the world. While it is open the world's keys rest (typing a search must not walk
// the view or toggle the walk grid); keys typed inside it reach its fields first.
import { type ReactNode, useEffect, useRef } from "react";
import { placePanels } from "./place-panels.js";

export function PlaceDialog({ label, className, children }: { label: string; className: string; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const capture = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopImmediatePropagation();
				placePanels.close();
				return;
			}
			if (event.target instanceof Node && ref.current?.contains(event.target)) return;
			event.stopImmediatePropagation();
		};
		const bubble = (event: KeyboardEvent) => event.stopPropagation();
		window.addEventListener("keydown", capture, { capture: true });
		document.addEventListener("keydown", bubble);
		return () => {
			window.removeEventListener("keydown", capture, { capture: true });
			document.removeEventListener("keydown", bubble);
		};
	}, []);
	useEffect(() => {
		const panel = ref.current;
		const first =
			panel?.querySelector<HTMLElement>("input, textarea") ??
			panel?.querySelector<HTMLElement>(".aw-place-body button");
		first?.focus({ preventScroll: true });
	}, []);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking the dimmed world closes the panel; Escape does from the keyboard
		<div
			className="aw-place-veil"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) placePanels.close();
			}}
		>
			<div
				ref={ref}
				className={`aw-frame aw-place-panel ${className}`}
				role="dialog"
				aria-modal="true"
				aria-label={label}
			>
				<button
					type="button"
					className="aw-place-close"
					aria-label="Close"
					title="Close (Esc)"
					onClick={() => placePanels.close()}
				/>
				<div className="aw-place-body aw-parchment">{children}</div>
			</div>
		</div>
	);
}

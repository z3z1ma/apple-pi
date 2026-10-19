// The frame every function place's panel opens in: over the dimmed world, carved wood around parchment, closed by
// its button, Escape, or a click on the world. While it is open the world's keys rest (typing a search must not walk
// the view or toggle the walk grid); keys typed inside it reach its fields first.
import { type ReactNode, useEffect, useRef } from "react";
import { focusWorld, trapTab } from "../focus.js";
import { placePanels } from "./place-panels.js";

export function PlaceDialog({
	label,
	className,
	children,
	onClose,
}: {
	label: string;
	className: string;
	children: ReactNode;
	/** Closing by the button, Escape, or the world: the place's own panels close themselves (else `placePanels`). */
	onClose?: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	const close = () => (closeRef.current ?? placePanels.close)();
	// biome-ignore lint/correctness/useExhaustiveDependencies: `close` reads the latest `onClose` through its ref
	useEffect(() => {
		const capture = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopImmediatePropagation();
				close();
				return;
			}
			if (trapTab(event, ref.current)) {
				event.stopImmediatePropagation();
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
			// Closed: the world has the keys again.
			focusWorld();
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
				if (event.target === event.currentTarget) close();
			}}
		>
			<div
				ref={ref}
				className={`aw-frame aw-place-panel ${className}`}
				role="dialog"
				aria-modal="true"
				aria-label={label}
			>
				<button type="button" className="aw-place-close" aria-label="Close" title="Close (Esc)" onClick={close} />
				<div className="aw-place-body aw-surface">{children}</div>
			</div>
		</div>
	);
}

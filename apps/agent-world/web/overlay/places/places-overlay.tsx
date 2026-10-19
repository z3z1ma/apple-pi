// The function places' panels as drawn over the world: the innkeeper's register, the rookery keeper's mail, and the confirmation
// before ending a busy session. Mounted once by the overlay; each shows while its state says so.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { say } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import type { WorldStore } from "../../world-store.js";
import { focusWorld, trapTab } from "../focus.js";
import { InnkeeperRegister } from "./innkeeper.js";
import { placeActions, placePanels } from "./place-panels.js";
import "./places.css";
import { RookeryView } from "./rookery.js";

export function PlacesOverlay({ store }: { store: WorldStore }) {
	const state = useSyncExternalStore(placePanels.subscribe, placePanels.get);
	const world = useSyncExternalStore(store.subscribe, store.get);
	return (
		<div className="aw-interface aw-places">
			{state.panel === "innkeeper" && <InnkeeperRegister key={state.opening} world={world} />}
			{state.panel === "rookery" && <RookeryView key={state.opening} world={world} />}
			{state.confirmEnd && <ConfirmEnd {...state.confirmEnd} />}
		</div>
	);
}

/**
 * Ending a busy session stops its turn (decision 13): a short themed question first, defaulting to letting it work.
 * Escape or a click outside lets it work.
 */
function ConfirmEnd({ id, name, reason }: { id: string; name: string; reason: string }) {
	const keep = useRef<HTMLButtonElement>(null);
	const dialog = useRef<HTMLDivElement>(null);
	const theme = useTheme();
	useEffect(() => {
		const before = document.activeElement;
		keep.current?.focus({ preventScroll: true });
		const capture = (event: KeyboardEvent) => {
			if (event.key === "Escape") placePanels.cancelEnd();
			// Tab moves between its two buttons; Enter and Space reach the one focused; nothing reaches the world.
			if (trapTab(event, dialog.current) || event.key === "Escape") return event.stopImmediatePropagation();
			if (event.target instanceof Node && dialog.current?.contains(event.target)) return;
			event.stopImmediatePropagation();
		};
		const bubble = (event: KeyboardEvent) => event.stopPropagation();
		window.addEventListener("keydown", capture, { capture: true });
		document.addEventListener("keydown", bubble);
		return () => {
			window.removeEventListener("keydown", capture, { capture: true });
			document.removeEventListener("keydown", bubble);
			// Back to what had the focus (a panel's button), or else the world.
			if (before instanceof HTMLElement && before.isConnected && before !== document.body) before.focus();
			else focusWorld();
		};
	}, []);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking the dimmed world lets it work; Escape does from the keyboard
		<div
			className="aw-place-veil aw-confirm-veil"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) placePanels.cancelEnd();
			}}
		>
			<div
				ref={dialog}
				className="aw-frame aw-confirm"
				role="alertdialog"
				aria-modal="true"
				aria-label={`End ${name}'s session?`}
				aria-describedby="aw-confirm-reason"
			>
				<div className="aw-confirm-body aw-surface">
					<span className="aw-confirm-mark" aria-hidden="true" />
					<h2>End {name}&rsquo;s session?</h2>
					<p id="aw-confirm-reason">{reason}</p>
					<p className="aw-confirm-after">{say(theme, "end-session-after")}</p>
					<div className="aw-confirm-actions">
						<button ref={keep} type="button" className="aw-button" onClick={() => placePanels.cancelEnd()}>
							Let it work
						</button>
						<button
							type="button"
							className="aw-button aw-button-danger"
							onClick={() => void placeActions.endSession({ id, name }, true)}
						>
							End the session
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

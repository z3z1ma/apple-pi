// The function places' panels as drawn over the world: the innkeeper's register, the rookery keeper's mail, and the confirmation
// before ending a busy session. Mounted once by the overlay; each shows while its state says so.
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { WorldStore } from "../../world-store.js";
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
	useEffect(() => {
		keep.current?.focus({ preventScroll: true });
		const capture = (event: KeyboardEvent) => {
			event.stopImmediatePropagation();
			if (event.key === "Escape") placePanels.cancelEnd();
		};
		window.addEventListener("keydown", capture, { capture: true });
		return () => window.removeEventListener("keydown", capture, { capture: true });
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
				className="aw-frame aw-confirm"
				role="alertdialog"
				aria-modal="true"
				aria-label={`End ${name}'s session?`}
				aria-describedby="aw-confirm-reason"
			>
				<div className="aw-confirm-body aw-parchment">
					<span className="aw-confirm-seal" aria-hidden="true" />
					<h2>End {name}&rsquo;s session?</h2>
					<p id="aw-confirm-reason">{reason}</p>
					<p className="aw-confirm-after">Its pane closes and it goes to the inn to sleep; you can wake it there.</p>
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

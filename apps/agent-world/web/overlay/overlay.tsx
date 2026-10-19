import { useEffect, useState, useSyncExternalStore } from "react";
import type { ViewStore } from "../view-state.js";
import type { WorldStore } from "../world-store.js";
import { ConversationPanel } from "./conversation/conversation-panel.js";
import { Interface } from "./interface/interface.js";
import { PlacesOverlay } from "./places/places-overlay.js";
import { PointerLayer } from "./pointer/pointer-layer.js";

const NOTICE_MS = 2600;
/** A broken theme's problems listed on screen; the rest are counted. */
const THEME_PROBLEMS_SHOWN = 3;

/** The HTML drawn over the world. */
export function Overlay({ store, view }: { store: WorldStore; view: ViewStore }) {
	const snapshot = useSyncExternalStore(store.subscribe, store.get);
	const state = useSyncExternalStore(view.subscribe, view.get);
	return (
		<>
			{state.title && (
				<header className="place-title">
					<strong>{state.title}</strong>
					{state.subtitle && <span>{state.subtitle}</span>}
				</header>
			)}
			<Interface store={store} view={view} />
			<PointerLayer />
			{state.notice && <Notice key={state.notice.id} text={state.notice.text} />}
			{state.themeProblem && (
				<ThemeNotice problem={state.themeProblem} onDismiss={() => view.update({ themeProblem: undefined })} />
			)}
			{state.chooser && (
				<div className="chooser" role="dialog" aria-label={state.chooser.title}>
					<strong>{state.chooser.title}</strong>
					{state.chooser.choices.map((choice) => (
						<button key={choice.label} type="button" onClick={choice.choose}>
							<span>{choice.label}</span>
							{choice.detail && <small>{choice.detail}</small>}
						</button>
					))}
					<button type="button" className="chooser-cancel" onClick={() => view.update({ chooser: undefined })}>
						Stay outside
					</button>
				</div>
			)}
			<PlacesOverlay store={store} />
			<ConversationPanel store={store} />
			{snapshot && !snapshot.connected && <DisconnectedNotice />}
		</>
	);
}

function Notice({ text }: { text: string }) {
	const [shown, setShown] = useState(true);
	useEffect(() => {
		const timer = setTimeout(() => setShown(false), NOTICE_MS);
		return () => clearTimeout(timer);
	}, []);
	return shown ? (
		<div className="notice" role="status">
			{text}
		</div>
	) : null;
}

/** Shown until dismissed: a pack the world could not wear, what it wears instead, and the pack check's findings. */
function ThemeNotice({
	problem,
	onDismiss,
}: {
	problem: NonNullable<ReturnType<ViewStore["get"]>["themeProblem"]>;
	onDismiss: () => void;
}) {
	const name = problem.theme.replace(/-/g, " ");
	const shown = problem.problems.slice(0, THEME_PROBLEMS_SHOWN);
	const more = problem.problems.length - shown.length;
	return (
		<div className="notice notice-lasting" role="alert">
			<strong>
				The {name} theme is broken, so the world {problem.switching ? "stays in" : "wears"} {problem.showing}.
			</strong>
			<ul>
				{shown.map((line) => (
					<li key={line}>{line}</li>
				))}
				{more > 0 && <li>and {more} more (the pack check, src/check-theme.ts, lists them all)</li>}
			</ul>
			<button type="button" onClick={onDismiss}>
				Dismiss
			</button>
		</div>
	);
}

function DisconnectedNotice() {
	return (
		<div className="disconnected-veil">
			<div className="disconnected" role="status">
				<strong>Disconnected</strong>
				<span>The session runtime is not answering. What you see may be out of date until it returns.</span>
			</div>
		</div>
	);
}

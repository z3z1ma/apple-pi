import { useEffect, useState, useSyncExternalStore } from "react";
import type { ViewStore } from "../view-state.js";
import type { WorldStore } from "../world-store.js";
import { ConversationPanel } from "./conversation/conversation-panel.js";
import { Interface } from "./interface/interface.js";
import { PointerLayer } from "./pointer/pointer-layer.js";

const NOTICE_MS = 2600;

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

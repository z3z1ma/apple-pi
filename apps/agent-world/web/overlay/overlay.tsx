import { useSyncExternalStore } from "react";
import type { WorldStore } from "../world-store.js";

/** The HTML drawn over the world. */
export function Overlay({ store }: { store: WorldStore }) {
	const snapshot = useSyncExternalStore(store.subscribe, store.get);
	return snapshot && !snapshot.connected ? <DisconnectedNotice /> : null;
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

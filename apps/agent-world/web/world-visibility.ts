import { useSyncExternalStore } from "react";

export function worldVisible(): boolean {
	return document.visibilityState !== "hidden" && !window.frameElement?.closest("[hidden]");
}

function subscribe(listener: () => void): () => void {
	window.addEventListener("world-visibilitychange", listener);
	document.addEventListener("visibilitychange", listener);
	return () => {
		window.removeEventListener("world-visibilitychange", listener);
		document.removeEventListener("visibilitychange", listener);
	};
}

export function useWorldVisible(): boolean {
	return useSyncExternalStore(subscribe, worldVisible);
}

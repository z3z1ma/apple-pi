import { useCallback, useEffect, useState } from "react";

/**
 * Whether the page reaches its page server, and with it the agent. A saved or shared copy never does, and a live
 * page stops when its session ends; either way the page hides what needs the agent and reads as a plain page. It
 * checks again whenever the reader comes back to the page, and `recheck` after any request to the server fails.
 */
export function useConnected(session: { token: string; live: boolean }): {
	connected: boolean;
	/** Whether the agent can answer questions now: the server is up and its session is live. */
	agent: boolean;
	recheck: () => void;
} {
	// A live page starts connected and changes only when a check fails, so its tools do not flicker in.
	const [state, setState] = useState({ connected: session.live, agent: session.live });
	const recheck = useCallback(() => {
		if (!session.live) return;
		fetch("/health", { headers: { "x-page-token": session.token } }).then(
			async (r) => {
				const body = r.ok ? ((await r.json().catch(() => ({}))) as { ask?: boolean }) : {};
				setState({ connected: r.ok, agent: r.ok && body.ask !== false });
			},
			() => setState({ connected: false, agent: false }),
		);
	}, [session.live, session.token]);
	useEffect(() => {
		recheck();
		const onVisible = () => {
			if (document.visibilityState === "visible") recheck();
		};
		addEventListener("focus", recheck);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			removeEventListener("focus", recheck);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [recheck]);
	return { ...state, recheck };
}

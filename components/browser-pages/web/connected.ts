import { useCallback, useEffect, useState } from "react";

export function useConnected(session: { token: string; live: boolean }): {
	connected: boolean;
	agent: boolean;
	recheck: () => void;
} {
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

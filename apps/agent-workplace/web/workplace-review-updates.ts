import { useCallback, useEffect, useMemo, useState } from "react";

const SEEN_KEY = "workplace-reviews-seen";
const POLL_MS = 2000;

type Seen = Record<string, string>;
export type ReviewUpdates = {
	updated: Map<string, string | null>;
	markSeen(id: string): void;
	markAllSeen(): void;
};

function readSeen(): Seen | null {
	try {
		const value = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "null");
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Seen) : null;
	} catch {
		return null;
	}
}

function writeSeen(seen: Seen) {
	try {
		localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
	} catch {}
}

export function useReviewUpdates(connected: boolean): ReviewUpdates {
	const [states, setStates] = useState<Record<string, string>>();
	const [seen, setSeen] = useState<Seen | null>(readSeen);
	useEffect(() => {
		if (!connected) return;
		let live = true;
		const read = () =>
			void Promise.resolve()
				.then(() => window.agentWorkplace.reviews.states({}))
				.then((rows) => {
					if (!live) return;
					const next = Object.fromEntries(rows.map((row) => [row.id, row.state]));
					setStates((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
					setSeen((previous) => {
						const kept = previous ? Object.fromEntries(Object.entries(previous).filter(([id]) => id in next)) : next;
						if (previous && Object.keys(kept).length === Object.keys(previous).length) return previous;
						writeSeen(kept);
						return kept;
					});
				})
				.catch(() => {});
		read();
		const timer = setInterval(read, POLL_MS);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [connected]);
	const updated = useMemo(() => {
		const changes = new Map<string, string | null>();
		if (!states || !seen) return changes;
		for (const [id, state] of Object.entries(states)) if (seen[id] !== state) changes.set(id, seen[id] ?? null);
		return changes;
	}, [states, seen]);
	const markSeen = useCallback(
		(id: string) => {
			const state = states?.[id];
			if (!state) return;
			setSeen((previous) => {
				if (previous?.[id] === state) return previous;
				const next = { ...previous, [id]: state };
				writeSeen(next);
				return next;
			});
		},
		[states],
	);
	const markAllSeen = useCallback(() => {
		if (!states) return;
		setSeen(states);
		writeSeen(states);
	}, [states]);
	return { updated, markSeen, markAllSeen };
}

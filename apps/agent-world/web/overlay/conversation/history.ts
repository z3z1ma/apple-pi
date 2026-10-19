// A conversation's loaded history: the newest page first, older pages prepended as the operator scrolls up, and new
// entries appended when the character's state changes (a settle, a tool) while the panel is open. Pages come from the
// backend's `conversation`, which reads them through the runtime without blocking the world.
import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "../../../src/world.js";
import type { ConversationApi } from "./panel-state.js";

export interface History {
	entries: TranscriptEntry[];
	/** The cursor for the page before the oldest loaded entry; null once the start of the conversation is loaded. */
	before: string | null;
	/** The first page has arrived. */
	ready: boolean;
	/** Entries the runtime indexed that its transcript no longer holds, in the pages read so far. */
	missing: number;
	loadingOlder: boolean;
	error?: string;
	loadOlder(): void;
	/** Read the newest page again and append what is new, as when a reply has just been stored. */
	refresh(): void;
	retry(): void;
}

/** Run `ask` so that a synchronous throw becomes a rejected promise. */
const call = <T>(ask: () => Promise<T>): Promise<T> => Promise.resolve().then(ask);

/** Entries of `fresh` (the newest page) that `known` lacks, or undefined when the page no longer reaches `known`. */
function newer(known: TranscriptEntry[], fresh: TranscriptEntry[]): TranscriptEntry[] | undefined {
	if (!known.length) return fresh;
	const last = known.at(-1)!.id;
	const index = fresh.findIndex((entry) => entry.id === last);
	if (index >= 0) return fresh.slice(index + 1);
	return fresh.length && fresh[0].at > known.at(-1)!.at ? undefined : [];
}

/**
 * The history of `characterId`'s conversation. `pulse` changes whenever the character's observed state does; each
 * change reads the newest page again and appends what is new.
 */
export function useHistory(api: ConversationApi | undefined, characterId: string, pulse: string): History {
	const [entries, setEntries] = useState<TranscriptEntry[]>([]);
	const [before, setBefore] = useState<string | null>(null);
	const [missing, setMissing] = useState(0);
	const [ready, setReady] = useState(false);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [error, setError] = useState<string>();
	const [attempt, setAttempt] = useState(0);
	const live = useRef({ entries, before, loadingOlder, ready, refreshing: false, again: false });
	live.current = { ...live.current, entries, before, loadingOlder, ready };

	// The newest page, on opening.
	useEffect(() => {
		if (!api) return;
		let gone = false;
		void attempt;
		call(() => api.conversation(characterId))
			.then((page) => {
				if (gone) return;
				if (!page.ok) {
					setError(page.reason);
					return;
				}
				setError(undefined);
				setEntries(page.entries);
				setBefore(page.before);
				setMissing(page.missing);
				setReady(true);
			})
			.catch((failure: unknown) => !gone && setError(String((failure as Error)?.message ?? failure)));
		return () => {
			gone = true;
		};
	}, [api, characterId, attempt]);

	const loadOlder = useCallback(() => {
		const now = live.current;
		if (!api || !now.ready || now.loadingOlder || !now.before) return;
		const cursor = now.before;
		live.current.loadingOlder = true;
		setLoadingOlder(true);
		call(() => api.conversation(characterId, cursor))
			.then((page) => {
				if (!page.ok) {
					setError(page.reason);
					return;
				}
				if (live.current.before !== cursor) return;
				setEntries((known) => [...page.entries.filter((e) => !known.some((k) => k.id === e.id)), ...known]);
				setBefore(page.before);
				setMissing((n) => n + page.missing);
			})
			.catch((failure: unknown) => setError(String((failure as Error)?.message ?? failure)))
			.finally(() => {
				live.current.loadingOlder = false;
				setLoadingOlder(false);
			});
	}, [api, characterId]);

	// Read the newest page again when the character's state changes, and append what is new.
	const refresh = useCallback(() => {
		const now = live.current;
		if (!api || !now.ready) return;
		if (now.refreshing) {
			now.again = true;
			return;
		}
		now.refreshing = true;
		call(() => api.conversation(characterId))
			.then((page) => {
				if (!page.ok) return;
				const fresh = newer(live.current.entries, page.entries);
				if (fresh === undefined) {
					// More happened than a page holds: start again from the newest page.
					setEntries(page.entries);
					setBefore(page.before);
				} else if (fresh.length) setEntries((known) => [...known, ...fresh]);
			})
			.catch(() => {})
			.finally(() => {
				live.current.refreshing = false;
				if (live.current.again) {
					live.current.again = false;
					refresh();
				}
			});
	}, [api, characterId]);

	const firstPulse = useRef(pulse);
	useEffect(() => {
		if (pulse === firstPulse.current) return;
		firstPulse.current = pulse;
		refresh();
	}, [pulse, refresh]);

	return {
		entries,
		before,
		ready,
		missing,
		loadingOlder,
		error,
		loadOlder,
		refresh,
		retry: () => {
			setError(undefined);
			setAttempt((n) => n + 1);
		},
	};
}

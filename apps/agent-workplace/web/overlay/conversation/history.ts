import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "../../../src/world.js";
import { worldVisible } from "../../world-visibility.js";
import type { ConversationApi } from "./panel-state.js";

export interface History {
	entries: TranscriptEntry[];

	before: string | null;

	ready: boolean;

	readPulse?: string;

	missing: number;
	loadingOlder: boolean;
	error?: string;
	loadOlder(): void;

	refresh(): void;
	retry(): void;
}

const call = <T>(ask: () => Promise<T> | undefined): Promise<T | undefined> => Promise.resolve().then(ask);
const canRead = (owner: { active: boolean }) => owner.active && (!window.frameElement || worldVisible());

function newer(known: TranscriptEntry[], fresh: TranscriptEntry[]): TranscriptEntry[] | undefined {
	if (!known.length) return fresh;
	const last = known.at(-1)!.id;
	const index = fresh.findIndex((entry) => entry.id === last);
	if (index >= 0) return fresh.slice(index + 1);
	return fresh.length && fresh[0].at > known.at(-1)!.at ? undefined : [];
}

export function useHistory(
	api: ConversationApi | undefined,
	characterId: string,
	pulse: string,
	textOnly = false,
): History {
	const [entries, setEntries] = useState<TranscriptEntry[]>([]);
	const [before, setBefore] = useState<string | null>(null);
	const [missing, setMissing] = useState(0);
	const [ready, setReady] = useState(false);
	const [readPulse, setReadPulse] = useState<string>();
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [error, setError] = useState<string>();
	const [attempt, setAttempt] = useState(0);
	const live = useRef({ entries, before, loadingOlder, ready, pulse, refreshing: false, again: false });
	live.current = { ...live.current, entries, before, loadingOlder, ready, pulse };
	const lifetime = useRef({ active: false });
	// biome-ignore lint/correctness/useExhaustiveDependencies: request ownership ends when the API or character changes.
	useEffect(() => {
		const owner = { active: true };
		lifetime.current = owner;
		live.current.refreshing = false;
		live.current.again = false;
		live.current.loadingOlder = false;
		setLoadingOlder(false);
		setReady(false);
		return () => {
			owner.active = false;
		};
	}, [api, characterId, textOnly]);

	useEffect(() => {
		if (!api) return;
		let gone = false;
		const owner = lifetime.current;
		const requestedPulse = live.current.pulse;
		void attempt;
		call(() => (!gone && canRead(owner) ? api.conversation(characterId, undefined, textOnly) : undefined))
			.then((page) => {
				if (gone || !canRead(owner) || !page) return;
				if (!page.ok) {
					setError(page.reason);
					return;
				}
				setError(undefined);
				setEntries(page.entries);
				setBefore(page.before);
				setMissing(page.missing);
				setReadPulse(requestedPulse);
				setReady(true);
			})
			.catch((failure: unknown) => !gone && canRead(owner) && setError(String((failure as Error)?.message ?? failure)));
		return () => {
			gone = true;
		};
	}, [api, characterId, attempt, textOnly]);

	const loadOlder = useCallback(() => {
		const now = live.current;
		const owner = lifetime.current;
		if (!api || !canRead(owner) || !now.ready || now.loadingOlder || !now.before) return;
		const cursor = now.before;
		live.current.loadingOlder = true;
		setLoadingOlder(true);
		call(() => (canRead(owner) ? api.conversation(characterId, cursor, textOnly) : undefined))
			.then((page) => {
				if (!canRead(owner) || !page) return;
				if (!page.ok) {
					setError(page.reason);
					return;
				}
				if (live.current.before !== cursor) return;
				setEntries((known) => [...page.entries.filter((e) => !known.some((k) => k.id === e.id)), ...known]);
				setBefore(page.before);
				setMissing((n) => n + page.missing);
			})
			.catch((failure: unknown) => canRead(owner) && setError(String((failure as Error)?.message ?? failure)))
			.finally(() => {
				if (!canRead(owner)) return;
				live.current.loadingOlder = false;
				setLoadingOlder(false);
			});
	}, [api, characterId, textOnly]);

	const refresh = useCallback(() => {
		const now = live.current;
		const owner = lifetime.current;
		if (!api || !canRead(owner) || !now.ready) return;
		if (now.refreshing) {
			now.again = true;
			return;
		}
		now.refreshing = true;
		const requestedPulse = now.pulse;
		call(() => (canRead(owner) ? api.conversation(characterId, undefined, textOnly) : undefined))
			.then((page) => {
				if (!canRead(owner) || !page) return;
				if (!page.ok) {
					setError(page.reason);
					return;
				}
				setError(undefined);
				setReadPulse(requestedPulse);
				const fresh = newer(live.current.entries, page.entries);
				if (fresh === undefined) {
					setEntries(page.entries);
					setBefore(page.before);
				} else if (fresh.length) setEntries((known) => [...known, ...fresh]);
			})
			.catch((failure: unknown) => canRead(owner) && setError(String((failure as Error)?.message ?? failure)))
			.finally(() => {
				if (!canRead(owner)) return;
				live.current.refreshing = false;
				if (live.current.again) {
					live.current.again = false;
					refresh();
				}
			});
	}, [api, characterId, textOnly]);

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
		readPulse,
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

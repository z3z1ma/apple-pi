// The reply a character is writing, as it streams in (decision 20): the panel watches the open character's replies,
// shows each stream's text as it grows, and at its end swaps in the stored transcript entry, which says the same words,
// so nothing jumps. The entry stays shown here until the history has read it too, then the history holds it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplyStreamEvent, TranscriptEntry } from "../../../src/world.js";
import type { ConversationApi } from "./panel-state.js";

interface Stream {
	streamId: string;
	at: number;
	text: string;
	/** The stored entry, once the stream ended with one. */
	entry?: TranscriptEntry;
}

/** The id a streaming reply is drawn under until its stored entry replaces it. */
export const liveId = (streamId: string) => `live:${streamId}`;
export const isLive = (entryId: string) => entryId.startsWith("live:");

/**
 * The entries to draw after the history: each reply still being written (as an assistant entry with its text so far)
 * and each finished one the history has not read yet. `onEnd` is called when a stream ends, so the history reads the
 * newest page again.
 */
export function useLiveReplies(
	api: ConversationApi | undefined,
	characterId: string,
	history: TranscriptEntry[],
	onEnd: () => void,
): TranscriptEntry[] {
	const [streams, setStreams] = useState<Stream[]>([]);
	const ended = useRef(onEnd);
	ended.current = onEnd;

	useEffect(() => {
		if (!api?.onReply || !api.watchReplies) return;
		const reader = {};
		const watch = window.agentWorldReplyWatches;
		const stop = api.onReply((event: ReplyStreamEvent) => {
			if (event.characterId !== characterId) return;
			if (event.kind === "delta")
				setStreams((now) => {
					const index = now.findIndex((s) => s.streamId === event.streamId);
					if (index < 0) return [...now, { streamId: event.streamId, at: Date.now(), text: event.delta }];
					if (now[index].entry) return now;
					const next = [...now];
					next[index] = { ...now[index], text: now[index].text + event.delta };
					return next;
				});
			else {
				// The end closes every earlier stream; those without an entry are left to the history.
				const entry = event.entry;
				setStreams((now) => {
					const finished = now.filter((s) => s.entry && s.streamId !== event.streamId);
					if (!entry) return finished;
					const was = now.find((s) => s.streamId === event.streamId);
					return [...finished, { streamId: event.streamId, at: was?.at ?? Date.now(), text: was?.text ?? "", entry }];
				});
				ended.current();
			}
		});
		void watch(reader, characterId).catch(() => {});
		return () => {
			stop();
			void watch(reader).catch(() => {});
		};
	}, [api, characterId]);

	// Once the history holds a finished reply's entry, it is drawn from there.
	const known = useMemo(() => new Set(history.map((entry) => entry.id)), [history]);
	useEffect(() => {
		if (streams.some((s) => s.entry && known.has(s.entry.id)))
			setStreams((now) => now.filter((s) => !(s.entry && known.has(s.entry.id))));
	}, [streams, known]);

	return useMemo(
		() =>
			streams
				.filter((s) => !(s.entry && known.has(s.entry.id)))
				.map(
					(s): TranscriptEntry =>
						s.entry ?? {
							kind: "assistant",
							id: liveId(s.streamId),
							at: s.at,
							parts: [{ kind: "text", text: s.text }],
							error: null,
							aborted: false,
						},
				),
		[streams, known],
	);
}

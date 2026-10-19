// The chatbox at the bottom left: world events as lines (the runtime's feed, and what the operator did here), with a
// toggle per kind. It keeps to the newest line unless the operator has scrolled up to read. It is compact by default
// (about five lines, so the world stays the hero), shows more lines on demand, and folds down to its bar.
import { useLayoutEffect, useRef } from "react";
import type { FeedKind } from "../../../src/world.js";
import { ChevronIcon, GrowIcon } from "./icons.js";

export type ChatKind = "game" | FeedKind;

export interface ChatLine {
	key: string;
	at: number;
	kind: ChatKind;
	character: string | null;
	name: string | null;
	text: string;
}

export const CHAT_KINDS: { kind: ChatKind; title: string }[] = [
	{ kind: "game", title: "Game" },
	{ kind: "agents", title: "Agents" },
	{ kind: "mail", title: "Mail" },
	{ kind: "commands", title: "Commands" },
];

const time = (at: number) => {
	const d = new Date(at);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function Chatbox({
	lines,
	hidden,
	onToggle,
	onAll,
	folded,
	onFold,
	tall,
	onTall,
	awake,
	onName,
}: {
	lines: ChatLine[];
	hidden: Set<ChatKind>;
	onToggle: (kind: ChatKind) => void;
	onAll: () => void;
	folded: boolean;
	onFold: () => void;
	/** Showing more lines than the compact five. */
	tall: boolean;
	onTall: () => void;
	/** Whether a character is awake, so its name can be examined from a line. */
	awake: (id: string) => boolean;
	onName: (id: string) => void;
}) {
	const log = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);
	const shown = lines.filter((line) => !hidden.has(line.kind));
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll again whenever the shown lines change.
	useLayoutEffect(() => {
		if (log.current && pinned.current) log.current.scrollTop = log.current.scrollHeight;
	}, [shown.length, shown.at(-1)?.key, folded, tall]);
	return (
		<section className={`aw-frame aw-chat${folded ? " aw-folded" : tall ? " aw-chat-tall" : ""}`} aria-label="Chatbox">
			{!folded && (
				<div
					ref={log}
					className="aw-chat-log aw-parchment"
					role="log"
					aria-label="World events"
					onScroll={(event) => {
						const el = event.currentTarget;
						pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
					}}
				>
					{shown.length === 0 && <p className="aw-empty">Nothing yet.</p>}
					{shown.map((line) => (
						<p key={line.key} className={`aw-chat-line aw-chat-${line.kind}`} data-kind={line.kind}>
							<time>{time(line.at)}</time> <LineText line={line} awake={awake} onName={onName} />
						</p>
					))}
				</div>
			)}
			<div className="aw-chat-bar" role="toolbar" aria-label="Chat filters">
				<button
					type="button"
					className="aw-filter"
					aria-pressed={hidden.size === 0}
					onClick={onAll}
					title="Show every kind"
				>
					All
				</button>
				{CHAT_KINDS.map(({ kind, title }) => (
					<button
						key={kind}
						type="button"
						className={`aw-filter aw-filter-${kind}`}
						aria-pressed={!hidden.has(kind)}
						title={hidden.has(kind) ? `Show ${title.toLowerCase()} lines` : `Hide ${title.toLowerCase()} lines`}
						onClick={() => onToggle(kind)}
					>
						{title}
					</button>
				))}
				{!folded && (
					<button
						type="button"
						className="aw-fold"
						aria-label={tall ? "Show fewer lines" : "Show more lines"}
						title={tall ? "Show fewer lines" : "Show more lines"}
						aria-pressed={tall}
						onClick={onTall}
					>
						<GrowIcon grown={tall} />
					</button>
				)}
				<button
					type="button"
					className="aw-fold"
					aria-label={folded ? "Open the chatbox" : "Fold the chatbox"}
					title={folded ? "Open the chatbox" : "Fold the chatbox"}
					aria-expanded={!folded}
					onClick={onFold}
				>
					<ChevronIcon open={!folded} />
				</button>
			</div>
		</section>
	);
}

/** The line's text, its character's name a link to examine it while it is awake. */
function LineText({
	line,
	awake,
	onName,
}: {
	line: ChatLine;
	awake: (id: string) => boolean;
	onName: (id: string) => void;
}) {
	const { name, character, text } = line;
	if (!name || !character || !text.startsWith(name) || !awake(character)) return <span>{text}</span>;
	return (
		<span>
			<button type="button" className="aw-chat-name" onClick={() => onName(character)}>
				{name}
			</button>
			{text.slice(name.length)}
		</span>
	);
}

// The conversation panel (decision 17): talking to a character opens it over the dimmed world, drawn in the fantasy
// theme as an open book. The left page holds the character's large portrait (its expression follows its state), name,
// role and place, repository, ledger task, what it is doing now, and Go to its terminal; the right page holds the
// transcript, newest at the bottom, with older pages loading as the operator scrolls up. Opening it marks the character
// seen. The reply box (a later ticket) has its place at the foot of the right page.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Character, WorldSnapshot } from "../../../src/world.js";
import { type Expression, portraitFor } from "../../looks.js";
import type { WorldStore } from "../../world-store.js";
import { activity, attentionOf, placeName } from "../interface/model.js";
import "./conversation.css";
import { useHistory } from "./history.js";
import { conversationPanel } from "./panel-state.js";
import { BlockView, blockAt, blockKey, blocksOf, dayName, WorkingDirectory } from "./transcript.js";

/** Within this many px of the top, the page before loads. */
const LOAD_MARGIN = 400;
/** Within this many px of the bottom, new entries keep the view at the bottom. */
const STICK_MARGIN = 48;

export function ConversationPanel({ store }: { store: WorldStore }) {
	const panel = useSyncExternalStore(conversationPanel.subscribe, conversationPanel.get);
	const world = useSyncExternalStore(store.subscribe, store.get);
	if (!panel.character) return null;
	return <Book key={`${panel.opening}:${panel.character.id}`} opened={panel.character} world={world} store={store} />;
}

function Book({ opened, world, store }: { opened: Character; world: WorldSnapshot | undefined; store: WorldStore }) {
	const { api, theme } = conversationPanel.get();
	// The character as it is now; if it left the world meanwhile, as it was.
	const live = world?.characters.find((c) => c.id === opened.id);
	const character = live ?? opened;
	const facts = character.facts;
	const attention = attentionOf(character);

	// Opening the conversation is seeing it, in every view; so is a settle while the operator is looking at it.
	const [seenNote, setSeenNote] = useState<string>();
	const seenOnce = useRef(false);
	const needsYouSince = facts?.needsYouSince ?? null;
	useEffect(() => {
		if (needsYouSince === null || !api) return;
		if (!document.hasFocus() && seenOnce.current) return;
		seenOnce.current = true;
		void Promise.resolve()
			.then(() => api.markSeen(opened.id))
			.then(
				(result) => setSeenNote(result.ok ? undefined : `Could not mark it seen: ${result.reason}`),
				(failure: unknown) => setSeenNote(`Could not mark it seen: ${String(failure)}`),
			);
	}, [api, opened.id, needsYouSince]);

	// Finished work keeps its happy face while the conversation stays open, though seeing it clears the badge.
	const [happy, setHappy] = useState(attention === "finished");
	useEffect(() => {
		if (attention === "finished") setHappy(true);
		else if (attention === "working" || attention === "asking") setHappy(false);
	}, [attention]);
	const expression: Expression =
		attention === "asking" ? "worried" : attention === "working" ? "thinking" : happy ? "happy" : "neutral";

	const pulse = `${facts?.run}:${facts?.settledAt}:${facts?.tool?.since}:${facts?.needsYouSince}`;
	const history = useHistory(api, opened.id, pulse);

	// Escape closes; while open, the world's keys (walking, the walk grid) rest. Key releases still reach it, so no key
	// stays held down.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			event.stopImmediatePropagation();
			if (event.key === "Escape") conversationPanel.close();
		};
		window.addEventListener("keydown", onKey, { capture: true });
		return () => window.removeEventListener("keydown", onKey, { capture: true });
	}, []);

	const [terminal, setTerminal] = useState<string>();
	const goToTerminal = () => {
		setTerminal(undefined);
		void store
			.goToTerminal(opened.id)
			.then((result) => setTerminal(result.ok ? undefined : result.reason))
			.catch((failure: unknown) => setTerminal(String(failure)));
	};

	const place = placeName(character.place, world, theme?.labels);
	const repository = facts?.git?.repository.split("/").filter(Boolean).pop();
	const doing = activity(character);
	const portrait = theme ? portraitFor(theme, character, expression) : undefined;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking the dimmed world closes the book; Escape does from the keyboard
		<div
			className="aw-conv-veil"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) conversationPanel.close();
			}}
		>
			<div className="aw-book" role="dialog" aria-modal="true" aria-label={`Conversation with ${character.name}`}>
				<span className="aw-book-corner aw-tl" aria-hidden="true" />
				<span className="aw-book-corner aw-tr" aria-hidden="true" />
				<span className="aw-book-corner aw-bl" aria-hidden="true" />
				<span className="aw-book-corner aw-br" aria-hidden="true" />
				<aside className="aw-page aw-page-left">
					<span className="aw-ribbon" aria-hidden="true" />
					<div className={`aw-portrait aw-portrait-${attention}`}>
						{portrait && <img src={portrait} alt={`${character.name}'s portrait`} draggable={false} />}
					</div>
					<h2 className="aw-conv-title">{character.name}</h2>
					<p className="aw-conv-role">
						{ROLE[character.role]} &middot; {place}
					</p>
					<dl className="aw-conv-facts">
						{repository && (
							<div>
								<dt>Repository</dt>
								<dd>
									{repository}
									{facts?.git?.branch && <span className="aw-conv-branch"> on {facts.git.branch}</span>}
								</dd>
							</div>
						)}
						<div>
							<dt>Ledger task</dt>
							<dd>
								{facts?.task ? (
									<>
										{facts.task.title}
										{facts.task.status && <span className="aw-conv-status">{facts.task.status}</span>}
									</>
								) : (
									<span className="aw-conv-quiet">None yet</span>
								)}
							</dd>
						</div>
						<div className={`aw-conv-doing aw-conv-doing-${attention}`}>
							<dt>{live ? "Doing now" : "Last seen"}</dt>
							<dd>{live ? <Doing character={character} text={doing} /> : "No longer running"}</dd>
						</div>
					</dl>
					<div className="aw-conv-side-foot">
						<button type="button" className="aw-plaque" onClick={goToTerminal}>
							Go to its terminal
						</button>
						{terminal && (
							<p className="aw-conv-warn" role="status">
								{terminal}
							</p>
						)}
						{seenNote && (
							<p className="aw-conv-warn" role="status">
								{seenNote}
							</p>
						)}
					</div>
				</aside>
				<section className="aw-page aw-page-right">
					<button
						type="button"
						className="aw-book-close"
						aria-label="Close"
						title="Close (Esc)"
						onClick={() => conversationPanel.close()}
					/>
					<WorkingDirectory.Provider value={facts?.cwd}>
						<Transcript history={history} name={character.name} />
					</WorkingDirectory.Provider>
					<footer className="aw-conv-reply-slot">
						<span className="aw-quill" aria-hidden="true" />
						<span>Replying from here comes soon; for now, answer in its terminal.</span>
					</footer>
				</section>
			</div>
		</div>
	);
}

const ROLE: Record<Character["role"], string> = {
	coordinator: "Coordinator",
	worker: "Worker",
	independent: "Independent",
};

/** What it is doing: a tool and its argument set apart, or the plain state. */
function Doing({ character, text }: { character: Character; text: string }) {
	const tool = character.facts?.tool;
	if (tool && attentionOf(character) === "working")
		return (
			<>
				<span className="aw-conv-tool-name">{tool.name}</span>
				{tool.arg && <code className="aw-conv-tool-arg">{tool.arg}</code>}
			</>
		);
	return <>{text}</>;
}

function Transcript({ history, name }: { history: ReturnType<typeof useHistory>; name: string }) {
	const log = useRef<HTMLDivElement>(null);
	const { blocks, results } = useMemo(() => blocksOf(history.entries), [history.entries]);
	const firstKey = blocks.length ? blockKey(blocks[0]) : undefined;
	const lastEntry = history.entries.at(-1)?.id;
	const layout = useRef<{ height: number; first?: string; last?: string; stuck: boolean; placed: boolean }>({
		height: 0,
		stuck: true,
		placed: false,
	});

	// Keep the view still when older pages arrive above it, and at the bottom when new entries arrive below while the
	// operator is at the bottom.
	useLayoutEffect(() => {
		const el = log.current;
		if (!el) return;
		const was = layout.current;
		if (!was.placed && history.ready) {
			el.scrollTop = el.scrollHeight;
			was.placed = true;
		} else if (was.first !== undefined && firstKey !== was.first) {
			el.scrollTop += el.scrollHeight - was.height;
		} else if (was.last !== lastEntry && was.stuck) {
			el.scrollTop = el.scrollHeight;
		}
		was.height = el.scrollHeight;
		was.first = firstKey;
		was.last = lastEntry;
	});

	// A first page that does not fill the page loads the one before at once.
	useEffect(() => {
		const el = log.current;
		if (el && history.ready && history.before && el.scrollHeight <= el.clientHeight + LOAD_MARGIN) history.loadOlder();
	});

	useEffect(() => {
		log.current?.focus({ preventScroll: true });
	}, []);

	const onScroll = () => {
		const el = log.current;
		if (!el) return;
		layout.current.stuck = el.scrollHeight - el.clientHeight - el.scrollTop < STICK_MARGIN;
		if (el.scrollTop < LOAD_MARGIN) history.loadOlder();
	};

	let day = "";
	return (
		<>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: the transcript scrolls with the keyboard */}
			<div className="aw-conv-log" role="log" aria-label="Transcript" tabIndex={0} ref={log} onScroll={onScroll}>
				{history.ready && !history.before && blocks.length > 0 && (
					<div className="aw-conv-start">The beginning of the conversation</div>
				)}
				{blocks.map((block) => {
					const at = blockAt(block);
					const name_ = at ? dayName(at) : day;
					const divider = name_ !== day;
					day = name_;
					return (
						<div key={blockKey(block)} className="aw-conv-block">
							{divider && (
								<div className="aw-conv-day" aria-hidden="true">
									<span>{name_}</span>
								</div>
							)}
							<BlockView block={block} name={name} results={results} />
						</div>
					);
				})}
				{history.ready && blocks.length === 0 && !history.error && (
					<p className="aw-conv-empty">Nothing has been said yet.</p>
				)}
				{!history.ready && !history.error && <p className="aw-conv-empty">Opening the book&hellip;</p>}
				{history.error && (
					<div className="aw-conv-empty">
						<p>Could not read the conversation: {history.error}</p>
						<button type="button" className="aw-plaque aw-plaque-small" onClick={history.retry}>
							Try again
						</button>
					</div>
				)}
			</div>
			{history.loadingOlder && (
				<div className="aw-conv-loading" role="status">
					Turning back the pages&hellip;
				</div>
			)}
		</>
	);
}

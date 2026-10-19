// The conversation panel (decision 17): talking to a character opens it over the dimmed world, drawn by the theme's
// skin (an open book in fantasy, a document window in the tech office, a notebook in the anime school). The side pane
// holds the character's large portrait (its expression follows its state), name,
// role and place, repository, ledger task, what it is doing now, and Go to its terminal; the main pane holds the
// transcript, newest at the bottom, with older pages loading as the operator scrolls up. Opening it marks the character
// seen. The foot of the main pane holds what the operator can do by its state (`actions.tsx`), and the reply being
// written streams in at the bottom of the transcript (`live-reply.ts`).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Character, TranscriptEntry, WorldSnapshot } from "../../../src/world.js";
import { type Expression, portraitFor } from "../../looks.js";
import { say } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import type { WorldStore } from "../../world-store.js";
import { activity, ago, attentionOf, placeName } from "../interface/model.js";
import { placeActions, placePanels } from "../places/place-panels.js";
import { Footer } from "./actions.js";
import "./conversation.css";
import { focusWorld, trapTab } from "../focus.js";
import { shortArg } from "../tool-line.js";
import { useHistory } from "./history.js";
import { useLiveReplies } from "./live-reply.js";
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
	return <Panel key={`${panel.opening}:${panel.character.id}`} opened={panel.character} world={world} store={store} />;
}

function Panel({ opened, world, store }: { opened: Character; world: WorldSnapshot | undefined; store: WorldStore }) {
	const { api } = conversationPanel.get();
	const theme = useTheme();
	// The character as it is now; if it left the world meanwhile, as it was.
	const live = world?.characters.find((c) => c.id === opened.id);
	const character = live ?? opened;
	// Asleep at the inn (dormant): it can be woken here instead of reached in a terminal it no longer has.
	const sleeper = live ? undefined : world?.dormant?.find((agent) => agent.id === opened.id);
	const places = useSyncExternalStore(placePanels.subscribe, placePanels.get);
	const waking = places.wakes[opened.id];
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
	const streaming = useLiveReplies(api, opened.id, history.entries, history.refresh);
	const [sentCount, setSentCount] = useState(0);

	// Escape closes (a confirmation first); while open, the world's keys (walking, the walk grid) rest. Keys typed in
	// the book reach its fields and buttons, then stop at the document before the world's listener on the window. Key
	// releases still reach the world, so no key stays held down.
	const panelRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const capture = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopImmediatePropagation();
				conversationPanel.escape();
				return;
			}
			// Tab stays in the book (in an open confirmation, in that).
			const confirm = panelRef.current?.querySelector<HTMLElement>("[role=alertdialog]");
			if (trapTab(event, confirm ?? panelRef.current)) {
				event.stopImmediatePropagation();
				return;
			}
			if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
			event.stopImmediatePropagation();
		};
		const bubble = (event: KeyboardEvent) => event.stopPropagation();
		window.addEventListener("keydown", capture, { capture: true });
		document.addEventListener("keydown", bubble);
		return () => {
			window.removeEventListener("keydown", capture, { capture: true });
			document.removeEventListener("keydown", bubble);
			// Closed: the world has the keys again.
			focusWorld();
		};
	}, []);

	// Links open in the system browser, through the main process; a refusal or failure shows where Go to does.
	const openLink = (href: string) => {
		if (!api?.openLink) return setTerminal("This window cannot open links.");
		setTerminal(undefined);
		void Promise.resolve()
			.then(() => api.openLink!(href))
			.then((result) => setTerminal(result.ok ? undefined : result.reason))
			.catch((failure: unknown) => setTerminal(String(failure)));
	};

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
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking the dimmed world closes the panel; Escape does from the keyboard
		<div
			className="aw-conv-veil"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) conversationPanel.close();
			}}
		>
			<div
				ref={panelRef}
				className="aw-conv-panel"
				role="dialog"
				aria-modal="true"
				aria-label={`Conversation with ${character.name}`}
			>
				<span className="aw-conv-ornament aw-tl" aria-hidden="true" />
				<span className="aw-conv-ornament aw-tr" aria-hidden="true" />
				<span className="aw-conv-ornament aw-bl" aria-hidden="true" />
				<span className="aw-conv-ornament aw-br" aria-hidden="true" />
				<aside className="aw-conv-pane aw-conv-side">
					<span className="aw-conv-marker" aria-hidden="true" />
					<div className={`aw-portrait aw-portrait-${attention}`}>
						{portrait && <img src={portrait} alt={`${character.name}'s portrait`} draggable={false} />}
					</div>
					<h2 className="aw-conv-title">{character.name}</h2>
					<p className="aw-conv-role">
						{theme?.labels[character.role]} &middot; {place}
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
							<dt>{live ? "Doing now" : sleeper ? "Now" : "Last seen"}</dt>
							<dd>
								{live ? (
									<Doing character={character} text={doing} />
								) : sleeper ? (
									<>
										{say(theme, "asleep-here")}
										{sleeper.stoppedAt ? `, for ${ago(sleeper.stoppedAt)}` : ""}
									</>
								) : (
									"No longer running"
								)}
							</dd>
						</div>
					</dl>
					<div className="aw-conv-side-foot">
						{sleeper ? (
							<button
								type="button"
								className="aw-cta"
								disabled={waking?.state === "sending"}
								onClick={() => void placeActions.wake(sleeper)}
							>
								Wake {character.name}
							</button>
						) : (
							<button type="button" className="aw-cta" onClick={goToTerminal}>
								Go to its terminal
							</button>
						)}
						{sleeper && waking && (
							<p className={`aw-conv-wake aw-conv-wake-${waking.state}`} role="status">
								{waking.text}
							</p>
						)}
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
				<section className="aw-conv-pane aw-conv-main">
					<button
						type="button"
						className="aw-conv-close"
						aria-label="Close"
						title="Close (Esc)"
						onClick={() => conversationPanel.close()}
					/>
					<WorkingDirectory.Provider value={facts?.cwd}>
						<Transcript history={history} live={streaming} name={character.name} sent={sentCount} onLink={openLink} />
					</WorkingDirectory.Provider>
					{live ? (
						<Footer
							character={character}
							onSend={() => setSentCount((n) => n + 1)}
							goToTerminal={goToTerminal}
							terminalProblem={terminal}
						/>
					) : (
						<footer className="aw-conv-reply-slot">
							<span className="aw-conv-pen" aria-hidden="true" />
							<span>
								{sleeper
									? say(theme, "conversation-asleep", { name: character.name })
									: `${character.name} is no longer running, so it cannot be told anything here.`}
							</span>
						</footer>
					)}
				</section>
			</div>
		</div>
	);
}

/** What it is doing: a tool and its argument set apart, or the plain state. */
function Doing({ character, text }: { character: Character; text: string }) {
	const tool = character.facts?.tool;
	if (tool && attentionOf(character) === "working")
		return (
			<>
				<span className="aw-conv-tool-name">{tool.name}</span>
				{tool.arg && <code className="aw-conv-tool-arg">{shortArg(tool.arg, character.facts?.cwd)}</code>}
			</>
		);
	return <>{text}</>;
}

/** A click on a web link in the transcript: the window stays put, and the system browser opens it. */
function openLinkIn(event: React.MouseEvent, open: (href: string) => void) {
	const link = event.target instanceof Element ? event.target.closest("a.aw-md-link") : null;
	if (!link) return;
	event.preventDefault();
	const href = link.getAttribute("href");
	if (href) open(href);
}

function Transcript({
	history,
	live,
	name,
	sent,
	onLink,
}: {
	history: ReturnType<typeof useHistory>;
	/** Open a web link in the system browser. */
	onLink: (href: string) => void;
	/** Replies being written, and written ones the history has not read yet, drawn after it. */
	live: TranscriptEntry[];
	name: string;
	/** Counts instructions sent; each one brings the view back to the bottom. */
	sent: number;
}) {
	const theme = useTheme();
	const log = useRef<HTMLDivElement>(null);
	const entries = useMemo(
		() => (live.length ? [...history.entries, ...live] : history.entries),
		[history.entries, live],
	);
	const { blocks, results } = useMemo(() => blocksOf(entries), [entries]);
	const firstKey = blocks.length ? blockKey(blocks[0]) : undefined;
	const layout = useRef<{ height: number; first?: string; sent: number; stuck: boolean; placed: boolean }>({
		height: 0,
		sent,
		stuck: true,
		placed: false,
	});

	// Keep the view still when older pages arrive above it, and at the bottom while the operator is there as entries
	// arrive or a reply grows below; sending brings it back to the bottom.
	useLayoutEffect(() => {
		const el = log.current;
		if (!el) return;
		const was = layout.current;
		if (!was.placed && history.ready) {
			el.scrollTop = el.scrollHeight;
			was.placed = true;
		} else if (was.first !== undefined && firstKey !== was.first) {
			el.scrollTop += el.scrollHeight - was.height;
		} else if (was.sent !== sent || (was.stuck && el.scrollHeight !== was.height)) {
			el.scrollTop = el.scrollHeight;
			was.stuck = true;
		}
		was.height = el.scrollHeight;
		was.first = firstKey;
		was.sent = sent;
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
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: links are anchors, so Enter on one clicks it and reaches here */}
			<div
				className="aw-conv-log"
				role="log"
				aria-label="Transcript"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: the transcript scrolls with the keyboard
				tabIndex={0}
				ref={log}
				onScroll={onScroll}
				onClick={(event) => openLinkIn(event, onLink)}
				onAuxClick={(event) => openLinkIn(event, onLink)}
			>
				{history.ready && !history.before && blocks.length > 0 && (
					<div className="aw-conv-start">The beginning of the conversation</div>
				)}
				{history.missing > 0 && (
					<p className="aw-conv-missing" role="note">
						{history.missing === 1
							? "One entry is no longer in its transcript file."
							: `${history.missing} entries are no longer in its transcript file.`}
					</p>
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
				{!history.ready && !history.error && <p className="aw-conv-empty">{say(theme, "conversation-opening")}</p>}
				{history.error && (
					<div className="aw-conv-empty">
						<p>Could not read the conversation: {history.error}</p>
						<button type="button" className="aw-cta aw-cta-small" onClick={history.retry}>
							Try again
						</button>
					</div>
				)}
			</div>
			{history.loadingOlder && (
				<div className="aw-conv-loading" role="status">
					{say(theme, "conversation-older")}
				</div>
			)}
		</>
	);
}

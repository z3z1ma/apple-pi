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
import { useWindowFocus } from "../../use-window-focus.js";
import { useWorldVisible, worldVisible } from "../../world-visibility.js";
import { focusWorld, trapTab } from "../focus.js";
import { shortArg } from "../tool-line.js";
import { type History, useHistory } from "./history.js";
import { useLiveReplies } from "./live-reply.js";
import { type ConversationApi, conversationPanel } from "./panel-state.js";
import {
	BlockView,
	blockAt,
	blockKey,
	blocksOf,
	blockVisible,
	dayName,
	OpenBrowserPage,
	WorkingDirectory,
} from "./transcript.js";

const LOAD_MARGIN = 400;

const STICK_MARGIN = 48;

export function ConversationPanel({ store }: { store: WorldStore }) {
	const panel = useSyncExternalStore(conversationPanel.subscribe, conversationPanel.get);
	const world = useSyncExternalStore(store.subscribe, store.get);
	const visible = useWorldVisible();
	if (!panel.character || !visible) return null;
	return <Panel key={`${panel.opening}:${panel.character.id}`} opened={panel.character} world={world} store={store} />;
}

export function EmbeddedConversation({
	character,
	store,
	showTools,
}: {
	character: Character;
	store: WorldStore;
	showTools: boolean;
}) {
	const world = useSyncExternalStore(store.subscribe, store.get);
	return <Panel key={character.id} opened={character} world={world} store={store} embedded showTools={showTools} />;
}

function useSeenConversation(
	api: ConversationApi | undefined,
	id: string,
	needsYouSince: number | null,
	ready: boolean,
) {
	const [note, setNote] = useState<string>();
	const seenOnce = useRef(false);
	const seenNeeds = useRef<number | null>(null);
	const visible = useWorldVisible();
	useEffect(() => {
		if (needsYouSince === null) {
			seenNeeds.current = null;
			return;
		}
		if (!visible || !api || !ready || seenNeeds.current === needsYouSince || (!document.hasFocus() && seenOnce.current))
			return;
		void Promise.resolve()
			.then(() => {
				if (!worldVisible() || seenNeeds.current === needsYouSince) return;
				seenOnce.current = true;
				seenNeeds.current = needsYouSince;
				return api.markSeen(id);
			})
			.then(
				(result) => {
					if (result) setNote(result.ok ? undefined : `Could not mark it seen: ${result.reason}`);
				},
				(failure: unknown) => setNote(`Could not mark it seen: ${String(failure)}`),
			);
	}, [api, id, needsYouSince, ready, visible]);
	return note;
}

function useReadPosition(history: History, pulse: string, facts: Character["facts"], embedded: boolean) {
	const [atLatest, setAtLatest] = useState(false);
	const focused = useWindowFocus();
	const unreadSince = useRef(facts?.unseen ? (facts.seenAt ?? 0) : undefined);
	if (embedded && facts?.unseen && (!atLatest || !focused) && unreadSince.current === undefined)
		unreadSince.current = facts.seenAt ?? 0;
	const firstRead = useRef(false);
	useEffect(() => {
		if (!embedded || !history.ready || firstRead.current) return;
		firstRead.current = true;
		if (history.readPulse !== pulse) history.refresh();
	}, [embedded, history.ready, history.readPulse, history.refresh, pulse]);
	return {
		unreadSince: embedded ? unreadSince.current : undefined,
		onAtLatest: embedded ? setAtLatest : undefined,
		ready: !embedded || (atLatest && focused && history.ready && !history.error && history.readPulse === pulse),
	};
}

function useInlinePage(person: string) {
	const [opened, setOpened] = useState<{ person: string; url: string; label: string }>();
	const [note, setNote] = useState<{ person: string; text: string }>();
	const openPage = async (callId: string, label: string) => {
		const live = await window.agentWorkplace.browserPage?.(person, callId);
		setNote(live ? undefined : { person, text: `That ${label.toLowerCase()} page is closed.` });
		if (!live) return;
		const url = new URL(live.url);
		const appearance = document.querySelector(".wp-app")?.getAttribute("data-appearance");
		if (appearance === "light" || appearance === "dark") url.searchParams.set("theme", appearance);
		setOpened({ person, url: url.href, label });
	};
	return {
		page: opened?.person === person ? opened : undefined,
		pageNote: note?.person === person ? note.text : undefined,
		openPage,
		closePage: () => setOpened(undefined),
	};
}

function InlinePage({
	page,
	note,
	onClose,
}: {
	page?: { url: string; label: string };
	note?: string;
	onClose(): void;
}) {
	return (
		<>
			{note && (
				<p className="aw-conv-warn" role="status">
					{note}
				</p>
			)}
			{page && (
				<section className="aw-conv-page" aria-label={`${page.label} page`}>
					<header>
						<button type="button" onClick={onClose}>
							Back to conversation
						</button>
						<strong>{page.label}</strong>
						<button type="button" onClick={() => void window.agentWorkplace.openLink?.(page.url)}>
							Open in browser
						</button>
					</header>
					<iframe title={`${page.label} page`} src={page.url} />
				</section>
			)}
		</>
	);
}

function Panel({
	opened,
	world,
	store,
	embedded = false,
	showTools = true,
}: {
	opened: Character;
	world: WorldSnapshot | undefined;
	store: WorldStore;
	embedded?: boolean;
	showTools?: boolean;
}) {
	const { api } = conversationPanel.get();
	const theme = useTheme();

	const live = world?.characters.find((c) => c.id === opened.id);
	const character = live ?? opened;

	const sleeper = live ? undefined : world?.dormant?.find((agent) => agent.id === opened.id);
	const former = sleeper?.retiredAt != null;
	const places = useSyncExternalStore(placePanels.subscribe, placePanels.get);
	const waking = places.wakes[opened.id];
	const facts = character.facts;
	const attention = attentionOf(character);

	const [happy, setHappy] = useState(attention === "finished");
	useEffect(() => {
		if (attention === "finished") setHappy(true);
		else if (attention === "working" || attention === "asking") setHappy(false);
	}, [attention]);
	const expression: Expression =
		attention === "asking" ? "worried" : attention === "working" ? "thinking" : happy ? "happy" : "neutral";

	const pulse = `${facts?.run}:${facts?.settledAt}:${facts?.tool?.since}:${facts?.needsYouSince}`;
	const history = useHistory(api, opened.id, pulse, !showTools);
	const streaming = useLiveReplies(api, opened.id, history.entries, history.refresh);
	const position = useReadPosition(history, pulse, facts, embedded);
	const seenNote = useSeenConversation(api, opened.id, facts?.needsYouSince ?? null, position.ready);
	const [sentCount, setSentCount] = useState(0);
	const { page, pageNote, openPage, closePage } = useInlinePage(character.id);

	const panelRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (embedded) return;
		const capture = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopImmediatePropagation();
				conversationPanel.escape();
				return;
			}

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

			if (worldVisible()) focusWorld();
		};
	}, [embedded]);

	const openLink = (href: string, file: boolean) => {
		const open = file ? api?.openFile : api?.openLink;
		if (!open) return setTerminal("This window cannot open links.");
		setTerminal(undefined);
		void Promise.resolve()
			.then(() => (file ? api!.openFile!(href, facts?.cwd ?? "") : api!.openLink!(href)))
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
	const progress =
		facts?.run &&
		{
			idle: "",
			thinking: "is thinking",
			writing_reply: "is typing",
			running_tool: "is working",
			compacting: "is updating context",
		}[facts.run];
	const toolProgress = facts?.run === "running_tool" && facts.tool ? doing : undefined;
	const portrait = theme ? portraitFor(theme, character, expression) : undefined;
	const accessibility = embedded
		? { role: "region" as const, "aria-label": `Conversation with ${character.name}` }
		: { role: "dialog" as const, "aria-modal": true as const, "aria-label": `Conversation with ${character.name}` };

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking the dimmed world closes the panel; Escape does from the keyboard
		<div
			className="aw-conv-veil"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) conversationPanel.close();
			}}
		>
			<div ref={panelRef} className="aw-conv-panel" {...accessibility}>
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
							<dt>Focused task</dt>
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
								) : former ? (
									`${say(theme, "retired")} (read-only)`
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
							!former && (
								<button
									type="button"
									className="aw-cta"
									disabled={waking?.state === "sending"}
									onClick={() => void placeActions.wake(sleeper)}
								>
									Wake {character.name}
								</button>
							)
						) : (
							<button type="button" className="aw-cta" onClick={goToTerminal}>
								Go to its terminal
							</button>
						)}
						{!former && sleeper && waking && (
							<p className={`aw-conv-wake aw-conv-wake-${waking.state}`} role="status">
								{waking.text}
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
					<InlinePage page={page} note={pageNote} onClose={closePage} />
					<div className="aw-conv-transcript-slot" hidden={!!page}>
						<WorkingDirectory.Provider value={facts?.cwd}>
							<OpenBrowserPage.Provider value={embedded ? (callId, label) => void openPage(callId, label) : undefined}>
								<Transcript
									history={history}
									live={streaming}
									name={character.name}
									sent={sentCount}
									onLink={openLink}
									showTools={showTools}
									unreadSince={position.unreadSince}
									onAtLatest={position.onAtLatest}
								/>
							</OpenBrowserPage.Provider>
						</WorkingDirectory.Provider>
					</div>
					{embedded && live && facts?.run && facts.run !== "idle" && !facts.asking && (
						<div className="wp-typing" role="status">
							<span className="wp-typing-dots" aria-hidden="true">
								<i />
								<i />
								<i />
							</span>
							<span
								className="wp-typing-copy"
								title={`${character.name} ${progress}${toolProgress ? ` · ${toolProgress}` : ""}`}
							>
								<strong>{character.name}</strong> {progress}
								{toolProgress && (
									<>
										{" "}
										<span aria-hidden="true"> · </span>
										<code>{toolProgress}</code>
									</>
								)}
							</span>
						</div>
					)}
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
								{former
									? `${character.name} is a former member; this conversation is read-only.`
									: sleeper
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

function Doing({ character, text }: { character: Character; text: string }) {
	const tool = character.facts?.tool;
	if (tool && character.facts?.run === "running_tool")
		return (
			<>
				<span className="aw-conv-tool-name">{tool.name}</span>
				{tool.arg && <code className="aw-conv-tool-arg">{shortArg(tool.arg, character.facts?.cwd)}</code>}
			</>
		);
	return <>{text}</>;
}

function openLinkIn(event: React.MouseEvent, open: (href: string, file: boolean) => void) {
	const link = event.target instanceof Element ? event.target.closest("a.aw-md-link") : null;
	if (!link) return;
	event.preventDefault();
	const href = link.getAttribute("href");
	if (href) open(href, link.hasAttribute("data-file"));
}

function Transcript({
	history,
	live,
	name,
	sent,
	onLink,
	showTools,
	unreadSince,
	onAtLatest,
}: {
	unreadSince?: number;
	onAtLatest?: (latest: boolean) => void;
	history: ReturnType<typeof useHistory>;
	showTools: boolean;

	onLink: (href: string, file: boolean) => void;

	live: TranscriptEntry[];
	name: string;

	sent: number;
}) {
	const theme = useTheme();
	const log = useRef<HTMLDivElement>(null);
	const [away, setAway] = useState(false);
	const [newBelow, setNewBelow] = useState(false);
	const entries = useMemo(
		() => (live.length ? [...history.entries, ...live] : history.entries),
		[history.entries, live],
	);
	const { blocks: allBlocks, results } = useMemo(() => blocksOf(entries), [entries]);
	const blocks = useMemo(() => allBlocks.filter((block) => blockVisible(block, showTools)), [allBlocks, showTools]);
	const firstKey = blocks.length ? blockKey(blocks[0]) : undefined;
	const unreadIndex =
		unreadSince === undefined
			? -1
			: blocks.findIndex((block) => block.kind === "agent" && block.entries.some((entry) => entry.at > unreadSince));
	const lastEntry = useRef<TranscriptEntry | undefined>(undefined);
	const layout = useRef<{ height: number; first?: string; sent: number; stuck: boolean; placed: boolean }>({
		height: 0,
		sent,
		stuck: true,
		placed: false,
	});

	useLayoutEffect(() => {
		const el = log.current;
		if (!el) return;
		const was = layout.current;
		if (!was.placed && history.ready) {
			const unread = el.querySelector<HTMLElement>("[data-unread-start]");
			el.scrollTop =
				unread && (unreadIndex > 0 || !history.before)
					? unread.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
					: el.scrollHeight;
			was.placed = true;
		} else if (was.first !== undefined && firstKey !== was.first) {
			el.scrollTop += el.scrollHeight - was.height;
		} else if (was.sent !== sent || (was.stuck && el.scrollHeight !== was.height)) {
			el.scrollTop = el.scrollHeight;
			was.stuck = true;
		}
		if (
			onAtLatest &&
			was.placed &&
			!was.stuck &&
			was.first === firstKey &&
			lastEntry.current !== entries.at(-1) &&
			el.scrollHeight > was.height
		)
			setNewBelow(true);
		lastEntry.current = entries.at(-1);
		was.stuck = el.scrollHeight - el.clientHeight - el.scrollTop < STICK_MARGIN;
		if (onAtLatest && history.ready) {
			onAtLatest(was.stuck);
			setAway(!was.stuck);
			if (was.stuck) setNewBelow(false);
		}
		was.height = el.scrollHeight;
		was.first = firstKey;
		was.sent = sent;
	});

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
		if (onAtLatest) {
			onAtLatest(layout.current.stuck);
			setAway(!layout.current.stuck);
			if (layout.current.stuck) setNewBelow(false);
		}
		if (el.scrollTop < LOAD_MARGIN) history.loadOlder();
	};

	let day = "";
	const content = (
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
				{showTools && history.missing > 0 && (
					<p className="aw-conv-missing" role="note">
						{history.missing === 1
							? "One entry is no longer in its transcript file."
							: `${history.missing} entries are no longer in its transcript file.`}
					</p>
				)}
				{blocks.map((block, index) => {
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
							{index === unreadIndex && (
								<div className="aw-conv-unread" data-unread-start>
									<span aria-hidden="true">New</span>
									<hr aria-label="New updates" />
								</div>
							)}
							<BlockView block={block} name={name} results={results} showTools={showTools} />
						</div>
					);
				})}
				{history.ready && entries.length === 0 && !history.error && (
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
	if (!onAtLatest) return content;
	return (
		<div className="aw-conv-transcript">
			{content}
			{away && (
				<button
					type="button"
					className="aw-conv-jump"
					onClick={() => {
						const el = log.current;
						if (!el) return;
						el.scrollTop = el.scrollHeight;
						layout.current.stuck = true;
						onAtLatest(true);
						setAway(false);
						setNewBelow(false);
					}}
				>
					{newBelow ? "New messages - jump to latest" : "Jump to latest"} &darr;
				</button>
			)}
		</div>
	);
}

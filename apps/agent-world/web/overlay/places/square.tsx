// The town square's panels (tickets 27 and 28). The crier reaches any Slack channel, read or unread, by search; a
// channel reads in a panel with names, times, and messages, its threads expanding. In a thread the operator replies as
// himself, only through the outside-write gate's confirmation (the exact text and where it goes), or asks an agent to
// look into it, which is an instruction to the agent and posts nothing to Slack.
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SlackChannel, SlackMessage, SlackThread } from "../../../src/integrations.js";
import type { Character, WorldSnapshot } from "../../../src/world.js";
import { townsfolkLook } from "../../game/places/square.js";
import { portraitOf } from "../../looks.js";
import { say, type Theme } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import { chatLines } from "../interface/chat-lines.js";
import { ConfirmWrite, confirming, useOutsideWrite, type WriteApi } from "./outside-write.js";
import { PlaceDialog } from "./place-dialog.js";
import { channelTitle, type SlackState, slack, unreadLabel } from "./slack-state.js";
import { type ChannelRef, squarePanels } from "./square-panels.js";
import "./square.css";

/** Shown while the crier's search waits for the operator to stop typing (ms). */
const SEARCH_PAUSE_MS = 220;

const useSlack = () => useSyncExternalStore(slack.subscribe, slack.get);
const failure = (error: unknown) => String((error as Error)?.message ?? error);

export function SquarePanels({ world }: { world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(squarePanels.subscribe, squarePanels.get);
	const panel = state.panel;
	if (!panel) return null;
	if (panel.kind === "crier") return <CrierPanel key={state.opening} />;
	return <ChannelPanel key={state.opening} channel={panel.channel} look={panel.look} world={world} />;
}

/** A channel's kind as a small mark before its name: `#` for a channel, a lock, or a person. */
function KindMark({ kind }: { kind: SlackChannel["kind"] }) {
	return (
		<span className={`aw-slack-kind aw-slack-kind-${kind}`} aria-hidden="true">
			{kind === "channel" ? (
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
					<path
						d="M6 2.5 4.6 13.5M11.4 2.5 10 13.5M2.8 5.8h11M2.2 10.2h11"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
					/>
				</svg>
			) : kind === "private" ? (
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
					<rect x="3.2" y="7" width="9.6" height="6.6" rx="1.4" fill="currentColor" />
					<path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
				</svg>
			) : (
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
					<circle cx="8" cy="5.4" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.6" />
					<path
						d="M3 13.6c.5-2.7 2.5-4.1 5-4.1s4.5 1.4 5 4.1"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
					/>
				</svg>
			)}
		</span>
	);
}

/** Without a sign-in, a place that reads Slack says how to get one; the button opens Slack's own sign-in. */
export function SlackSignIn({ state, lead, settings }: { state: SlackState; lead?: ReactNode; settings?: boolean }) {
	return (
		<div className="aw-slack-signin">
			{lead}
			<button
				type="button"
				className="aw-button aw-button-strong"
				disabled={state.signingIn || state.status === "unavailable"}
				onClick={() => void slack.signIn()}
			>
				{state.signingIn ? "Waiting for Slack\u2026" : "Sign in to Slack"}
			</button>
			<p className="aw-slack-note">
				{state.signingIn
					? "Finish signing in in the Slack window; it closes by itself once you are in."
					: settings
						? "Opens Slack\u2019s own sign-in in a window. Agent World keeps your session in a private file on this Mac, never in the world\u2019s pages."
						: "Opens Slack\u2019s own sign-in in a window. You can also sign in or out under Settings."}{" "}
				Some workspaces forbid signing in this way; if yours does, Slack will not let the session be used.
			</p>
			{state.signInProblem && (
				<p className="aw-progress aw-progress-failed" role="status">
					{state.signInProblem}
				</p>
			)}
		</div>
	);
}

/** The crier: any channel by name, read or unread; with nothing typed, every channel with unread messages. */
function CrierPanel() {
	const theme = useTheme();
	const state = useSlack();
	const [text, setText] = useState("");
	const [found, setFound] = useState<{ text: string; channels?: SlackChannel[]; problem?: string }>();
	const label = theme?.labels.crier ?? "Crier";
	const signedIn = state.status === "signed-in";
	const unread = state.channels;
	const asked = text.trim();

	useEffect(() => {
		if (!signedIn) return;
		void slack.refresh();
	}, [signedIn]);

	useEffect(() => {
		const find = slack.api().slackFindChannels;
		if (!asked || !signedIn || !find) return setFound(undefined);
		let live = true;
		const timer = setTimeout(() => {
			setFound((now) => ({ text: asked, channels: now?.channels }));
			find(asked)
				.then((answer) => {
					if (!live) return;
					if (answer.ok) setFound({ text: asked, channels: answer.channels });
					else {
						slack.refused(answer);
						setFound({ text: asked, problem: answer.reason });
					}
				})
				.catch((error) => live && setFound({ text: asked, problem: failure(error) }));
		}, SEARCH_PAUSE_MS);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [asked, signedIn]);

	const greeting = !signedIn
		? say(theme, "crier-signed-out")
		: unread.length
			? say(theme, "crier-greeting", { count: unread.length })
			: say(theme, "crier-quiet");
	const unreadById = new Map(unread.map((channel) => [channel.id, channel]));
	const results = asked ? found?.channels?.map((channel) => unreadById.get(channel.id) ?? channel) : unread;
	const portrait = theme ? portraitOf(theme, "crier", signedIn && unread.length ? "happy" : "neutral") : undefined;

	return (
		<PlaceDialog
			label={label}
			className={`aw-crier${signedIn ? " aw-crier-listing" : ""}`}
			onClose={() => squarePanels.close()}
		>
			<header className="aw-place-head">
				<div className="aw-place-portrait">{portrait && <img src={portrait} alt={label} draggable={false} />}</div>
				<div className="aw-place-heading">
					<h2>{label}</h2>
					<p className="aw-place-says">&ldquo;{greeting}&rdquo;</p>
				</div>
			</header>
			{!signedIn ? (
				<SlackSignIn
					state={state}
					lead={
						<p className="aw-slack-lead">
							Sign in to Slack as yourself, and the channels with unread messages gather in the square; then any
							channel, read or unread, can be found here.
						</p>
					}
				/>
			) : (
				<>
					<label className="aw-place-search-wrap aw-crier-search">
						<span className="aw-sr">Find a channel</span>
						<input
							className="aw-place-search"
							type="search"
							placeholder={say(theme, "crier-search")}
							value={text}
							onChange={(event) => setText(event.target.value)}
						/>
					</label>
					<p className="aw-crier-caption" aria-live="polite">
						{crierCaption(asked, found, state)}
						{!asked && state.problem && <span className="aw-slack-problem"> {state.problem}</span>}
					</p>
					<ul className="aw-place-list aw-slack-list" aria-label={asked ? "Channels found" : "Unread channels"}>
						{(results ?? []).map((channel) => (
							<ChannelRow key={channel.id} channel={channel} theme={theme} />
						))}
					</ul>
				</>
			)}
		</PlaceDialog>
	);
}

/** What the crier's list shows: what was found for the name typed, or, with nothing typed, how many are unread. */
function crierCaption(
	asked: string,
	found: { channels?: SlackChannel[]; problem?: string } | undefined,
	state: SlackState,
): string {
	if (!asked) {
		const unread = state.channels.length;
		if (unread) return `${unread} ${unread === 1 ? "channel has" : "channels have"} unread messages`;
		return state.listed ? "Nothing unread. Type a channel\u2019s name to read it anyway." : "Reading Slack\u2026";
	}
	if (found?.problem) return found.problem;
	if (found?.channels === undefined) return "Looking\u2026";
	const n = found.channels.length;
	if (!n) return `No channel is named like \u201c${asked}\u201d.`;
	return `${n === 50 ? "The first 50" : n} ${n === 1 ? "channel" : "channels"} named like \u201c${asked}\u201d`;
}

/** One channel in a list: its kind, name, and unread count; choosing it reads it. */
export function ChannelRow({ channel, theme }: { channel: SlackChannel; theme: Theme | undefined }) {
	const unread = channel.unread !== null || channel.more || channel.mentions > 0 || channel.latest !== null;
	const look = theme ? townsfolkLook(theme, channel.id) : undefined;
	return (
		<li className="aw-slack-row">
			<button
				type="button"
				className="aw-slack-row-main"
				aria-label={`Read ${channelTitle(channel)}${channel.unread !== null ? `, ${unreadLabel(channel)} unread` : ""}`}
				onClick={() => squarePanels.openChannel(channel, look)}
			>
				<KindMark kind={channel.kind} />
				<span className="aw-slack-name">
					{channel.kind === "channel" || channel.kind === "private" ? channel.name : channelTitle(channel)}
				</span>
				{channel.mentions > 0 && (
					<span className="aw-slack-mentions" title={`${channel.mentions} mentioning you`}>
						@{channel.mentions}
					</span>
				)}
				{unread && (
					<span className="aw-slack-count" title="Unread messages">
						{unreadLabel(channel)}
					</span>
				)}
				<span className="aw-slack-go" aria-hidden="true">
					Read
				</span>
			</button>
		</li>
	);
}

/** A time as a channel shows it: the clock today, the weekday this week, else the date. */
function when(at: number): string {
	const date = new Date(at);
	const now = new Date();
	const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
	if (date.toDateString() === now.toDateString()) return clock;
	const days = (now.getTime() - at) / 86_400_000;
	if (days < 6) return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${clock}`;
	return date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
	});
}

/** Text with its links made clickable (they open in the browser); the rest as written. */
function Linked({ text }: { text: string }) {
	const parts = text.split(/(https?:\/\/[^\s)]+)/g);
	return (
		<>
			{parts.map((part, i) =>
				i % 2 ? (
					<a
						// biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text never reorder
						key={i}
						href={part}
						onClick={(event) => {
							event.preventDefault();
							void slack
								.api()
								.openLink?.(part)
								.catch(() => {});
						}}
					>
						{part}
					</a>
				) : (
					part
				),
			)}
		</>
	);
}

interface Opened {
	loading: boolean;
	messages?: SlackMessage[];
	url?: string | null;
	problem?: string;
}

/** What is being written under a thread: a reply as the operator, or a request to an agent. */
type Writing = { ts: string; mode: "reply" | "ask" };

/** A channel read in a panel: its latest messages, newest last, threads opening under their first message. */
function ChannelPanel({
	channel,
	look,
	world,
}: {
	channel: ChannelRef;
	look?: string;
	world: WorldSnapshot | undefined;
}) {
	const theme = useTheme();
	const state = useSlack();
	const [read, setRead] = useState<{ thread?: SlackThread; problem?: string }>({});
	const [threads, setThreads] = useState<Record<string, Opened>>({});
	const [writing, setWriting] = useState<Writing>();
	const api = slack.api();
	const write = useOutsideWrite(api.describeWrite && api.confirmWrite ? (api as WriteApi) : undefined);
	const list = useRef<HTMLDivElement>(null);
	const title = channelTitle(channel);
	const listed = state.channels.find((c) => c.id === channel.id);
	const unread = listed?.unread ?? channel.unread ?? 0;
	const wearer = look ?? (theme ? townsfolkLook(theme, channel.id) : undefined);
	const portrait = theme && wearer ? portraitOf(theme, wearer, listed?.mentions ? "worried" : "neutral") : undefined;

	useEffect(() => {
		const open = slack.api().slackChannel;
		if (!open) return setRead({ problem: "This window cannot read Slack." });
		let live = true;
		open(channel.id)
			.then((answer) => {
				if (!live) return;
				if (answer.ok) setRead({ thread: answer.thread });
				else {
					slack.refused(answer);
					setRead({ problem: answer.reason });
				}
			})
			.catch((error) => live && setRead({ problem: failure(error) }));
		return () => {
			live = false;
		};
	}, [channel.id]);

	const messages = read.thread?.messages ?? [];
	/** Where the unread messages begin: the channel's unread count, from the newest back. */
	const firstNew =
		unread > 0 && unread < messages.length ? messages.length - unread : unread >= messages.length ? 0 : -1;
	// Open at the first unread message (or the newest), as Slack does.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll once, when the messages first arrive
	useEffect(() => {
		const box = list.current;
		if (!box || !messages.length) return;
		const mark = box.querySelector<HTMLElement>(".aw-slack-new");
		if (mark && firstNew > 0) box.scrollTop = Math.max(0, mark.offsetTop - 12);
		else box.scrollTop = box.scrollHeight;
	}, [read.thread]);

	const openThread = async (ts: string) => {
		const open = slack.api().slackThread;
		if (!open) return;
		setThreads((now) => ({ ...now, [ts]: { ...now[ts], loading: true } }));
		try {
			const answer = await open(channel.id, ts);
			if (answer.ok)
				setThreads((now) => ({
					...now,
					[ts]: { loading: false, messages: answer.thread.messages.slice(1), url: answer.thread.url },
				}));
			else {
				slack.refused(answer);
				setThreads((now) => ({ ...now, [ts]: { loading: false, problem: answer.reason } }));
			}
		} catch (error) {
			setThreads((now) => ({ ...now, [ts]: { loading: false, problem: failure(error) } }));
		}
	};
	const toggleThread = (ts: string) => {
		if (threads[ts] && !threads[ts].loading && threads[ts].messages) {
			setThreads(({ [ts]: _closed, ...rest }) => rest);
			if (writing?.ts === ts) setWriting(undefined);
		} else void openThread(ts);
	};
	const startWriting = (ts: string, mode: Writing["mode"], replies: number) => {
		setWriting({ ts, mode });
		if (replies > 0 && !threads[ts]?.messages) void openThread(ts);
	};

	const sent = write.state.phase === "sent" ? write.state : undefined;
	// A reply sent: read its thread again, so it shows in place.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when a write was sent
	useEffect(() => {
		if (sent?.intent.kind === "slack-reply") void openThread(sent.intent.threadTs);
	}, [sent]);

	const subtitle = listed
		? `${unreadLabel(listed)} unread${listed.mentions ? `, ${listed.mentions} mentioning you` : ""}`
		: messages.length
			? "Nothing unread"
			: "";

	return (
		<PlaceDialog label={`${title} in Slack`} className="aw-slack-channel" onClose={() => squarePanels.close()}>
			<div className="aw-slack-inert" inert={confirming(write.state) ? true : undefined}>
				<header className="aw-place-head">
					<div className="aw-place-portrait">{portrait && <img src={portrait} alt="" draggable={false} />}</div>
					<div className="aw-place-heading">
						<h2 className="aw-slack-title">
							<KindMark kind={channel.kind} />
							<span>{channel.kind === "channel" || channel.kind === "private" ? channel.name : title}</span>
						</h2>
						<p className="aw-place-says aw-slack-sub">
							{subtitle}
							{state.account?.team && <span className="aw-slack-team"> &middot; {state.account.team}</span>}
						</p>
					</div>
					<div className="aw-slack-head-actions">
						<button type="button" className="aw-button" onClick={() => squarePanels.openCrier()}>
							Other channels
						</button>
						{read.thread?.url && (
							<button
								type="button"
								className="aw-button"
								title="Open this channel in Slack"
								onClick={() => void slack.api().openLink?.(read.thread!.url!)}
							>
								Open in Slack
							</button>
						)}
					</div>
				</header>
				<div ref={list} className="aw-slack-messages" role="log" aria-label={`Messages in ${title}`}>
					{read.problem && <p className="aw-place-empty">{read.problem}</p>}
					{!read.thread && !read.problem && <p className="aw-place-empty">Reading {title}&hellip;</p>}
					{read.thread && !messages.length && <p className="aw-place-empty">Nobody has written here yet.</p>}
					{messages.map((message, i) => {
						const ts = message.threadTs ?? message.ts;
						const opened = threads[ts];
						const here = writing?.ts === ts;
						return (
							<div key={message.ts} className="aw-slack-entry">
								{i === firstNew && (
									<div className="aw-slack-new">
										<span>New</span>
									</div>
								)}
								<Message
									message={message}
									acts={
										<>
											<button
												type="button"
												className="aw-slack-act"
												aria-pressed={here && writing?.mode === "reply"}
												onClick={() => startWriting(ts, "reply", message.replies)}
											>
												Reply
											</button>
											<button
												type="button"
												className="aw-slack-act"
												aria-pressed={here && writing?.mode === "ask"}
												onClick={() => startWriting(ts, "ask", message.replies)}
											>
												Ask an agent
											</button>
										</>
									}
								>
									{message.replies > 0 && (
										<button
											type="button"
											className="aw-slack-replies"
											aria-expanded={!!opened?.messages}
											onClick={() => toggleThread(ts)}
										>
											{opened?.loading
												? "Opening\u2026"
												: opened?.messages
													? "Hide replies"
													: `${message.replies} ${message.replies === 1 ? "reply" : "replies"}`}
										</button>
									)}
								</Message>
								{(opened || here) && (
									<section className="aw-slack-thread" aria-label={`Thread of ${message.name}`}>
										{opened?.problem && <p className="aw-place-empty">{opened.problem}</p>}
										{opened?.messages?.map((reply) => (
											<Message key={reply.ts} message={reply} reply />
										))}
										{here && writing.mode === "reply" && (
											<ReplyForm
												key={`reply:${ts}`}
												channel={channel}
												parent={message}
												threadTs={ts}
												write={write}
												onDone={() => setWriting(undefined)}
											/>
										)}
										{here && writing.mode === "ask" && (
											<AskForm
												key={`ask:${ts}`}
												channel={channel}
												parent={message}
												threadTs={ts}
												url={opened?.url ?? read.thread?.url ?? null}
												world={world}
												onDone={() => setWriting(undefined)}
											/>
										)}
									</section>
								)}
							</div>
						);
					})}
				</div>
			</div>
			{confirming(write.state) && (
				<ConfirmWrite
					state={write.state as Parameters<typeof ConfirmWrite>[0]["state"]}
					onConfirm={() => void write.confirm()}
					onCancel={write.cancel}
				/>
			)}
		</PlaceDialog>
	);
}

function Message({
	message,
	reply,
	acts,
	children,
}: {
	message: SlackMessage;
	reply?: boolean;
	/** What can be done with it, shown over its corner while the pointer or the focus is on it. */
	acts?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<article className={`aw-slack-message${reply ? " aw-slack-reply" : ""}`}>
			<header>
				<span className="aw-slack-author">{message.name}</span>
				<time dateTime={new Date(message.at).toISOString()} title={new Date(message.at).toLocaleString()}>
					{when(message.at)}
				</time>
			</header>
			<div className="aw-slack-text">
				<Linked text={message.text.trim() || "(no text)"} />
			</div>
			{children}
			{acts && <div className="aw-slack-acts">{acts}</div>}
		</article>
	);
}

/** A reply in a thread as the operator: the gate describes it, he confirms the exact text, and only then it is sent. */
function ReplyForm({
	channel,
	parent,
	threadTs,
	write,
	onDone,
}: {
	channel: ChannelRef;
	parent: SlackMessage;
	threadTs: string;
	write: ReturnType<typeof useOutsideWrite>;
	onDone: () => void;
}) {
	const [text, setText] = useState("");
	const field = useRef<HTMLTextAreaElement>(null);
	useEffect(() => field.current?.focus({ preventScroll: false }), []);
	const { state } = write;
	const mine = "intent" in state && state.intent.kind === "slack-reply" && state.intent.threadTs === threadTs;
	const ask = () => {
		if (!text.trim()) return;
		void write.ask({ kind: "slack-reply", channel: channel.id, threadTs, text });
	};
	if (mine && state.phase === "sent")
		return (
			<div className="aw-slack-form aw-slack-done">
				<p className="aw-progress aw-progress-done" role="status">
					Sent in the thread as you. It is in the chatbox and your local record.
				</p>
				<button
					type="button"
					className="aw-button"
					onClick={() => {
						write.cancel();
						onDone();
					}}
				>
					Done
				</button>
			</div>
		);
	return (
		<form
			className="aw-slack-form"
			onSubmit={(event) => {
				event.preventDefault();
				ask();
			}}
		>
			<textarea
				ref={field}
				className="aw-conv-input aw-slack-input"
				aria-label={`Reply to ${parent.name}'s thread`}
				placeholder={`Reply to ${parent.name} in ${channelTitle(channel)}, as you`}
				rows={3}
				value={text}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) ask();
				}}
			/>
			<div className="aw-slack-form-foot">
				<span className="aw-slack-note">
					{mine && state.phase === "failed"
						? state.reason
						: mine && state.phase === "describing"
							? "Getting it ready to confirm\u2026"
							: "Posted in Slack under your name, after you confirm the exact text."}
				</span>
				<button type="button" className="aw-button" onClick={onDone}>
					Cancel
				</button>
				<button
					type="submit"
					className="aw-button aw-button-strong"
					disabled={!text.trim() || (mine && state.phase === "describing")}
				>
					Reply&hellip;
				</button>
			</div>
		</form>
	);
}

/** The agents who can be asked: the coordinator first (it can hand work on), then everyone awake by name. */
function askable(world: WorldSnapshot | undefined): Character[] {
	const awake = world?.characters ?? [];
	const coordinators = awake.filter((c) => c.role === "coordinator");
	const others = awake.filter((c) => c.role !== "coordinator").sort((a, b) => a.name.localeCompare(b.name));
	return [...coordinators, ...others];
}

/** Asking an agent to look into a thread: an instruction naming it, sent to the agent; nothing goes to Slack. */
function AskForm({
	channel,
	parent,
	threadTs,
	url,
	world,
	onDone,
}: {
	channel: ChannelRef;
	parent: SlackMessage;
	threadTs: string;
	url: string | null;
	world: WorldSnapshot | undefined;
	onDone: () => void;
}) {
	const agents = useMemo(() => askable(world), [world]);
	const [to, setTo] = useState(agents[0]?.id ?? "");
	const [note, setNote] = useState("");
	const [progress, setProgress] = useState<{ state: "sending" | "done" | "failed"; text: string }>();
	const chosen = agents.find((c) => c.id === to);
	const stop = useRef<() => void>(undefined);
	useEffect(() => () => stop.current?.(), []);

	const send = async () => {
		const delegate = slack.api().delegate;
		if (!chosen || !delegate) return;
		const id = `square:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
		setProgress({ state: "sending", text: `Asking ${chosen.name}\u2026` });
		// The receipt follows: delivered and applied, as for any instruction.
		stop.current?.();
		stop.current = slack.api().onReceipt?.((receipt) => {
			if (receipt.commandId !== id) return;
			if (receipt.stage === "applied")
				setProgress({ state: "done", text: `${chosen.name} has it. It reports back in its conversation.` });
			if (receipt.stage === "failed")
				setProgress({ state: "failed", text: receipt.reason ?? `${chosen.name} did not take it.` });
		});
		try {
			const answer = await delegate(id, {
				to: chosen.id,
				item: {
					kind: "thread",
					channel: channel.id,
					channelName: channel.name,
					ts: threadTs,
					url,
					preview: parent.text.replace(/\s+/g, " ").trim().slice(0, 120),
				},
				ask: "look-into",
				...(note.trim() ? { note: note.trim() } : {}),
			});
			if (!answer.ok) return setProgress({ state: "failed", text: answer.reason });
			chatLines.add(
				`You ask ${chosen.name} to look into ${parent.name}'s thread in ${channelTitle(channel)}.`,
				"commands",
			);
			setProgress((now) =>
				now?.state === "done"
					? now
					: {
							state: "done",
							text:
								answer.command === "talk"
									? `Asked ${chosen.name}. It reports back in its conversation.`
									: `${chosen.name} is busy; it reads this after its turn.`,
						},
			);
		} catch (error) {
			setProgress({ state: "failed", text: failure(error) });
		}
	};

	if (!agents.length)
		return (
			<div className="aw-slack-form">
				<p className="aw-slack-note">Nobody is awake to ask. Wake an agent at the inn first.</p>
				<button type="button" className="aw-button" onClick={onDone}>
					Cancel
				</button>
			</div>
		);
	if (progress && progress.state !== "sending")
		return (
			<div className="aw-slack-form aw-slack-done">
				<p className={`aw-progress aw-progress-${progress.state}`} role="status">
					{progress.text}
				</p>
				<button type="button" className="aw-button" onClick={onDone}>
					Done
				</button>
			</div>
		);
	return (
		<form
			className="aw-slack-form aw-slack-ask"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<label className="aw-slack-ask-to">
				<span>Ask</span>
				<select aria-label="Ask which agent" value={to} onChange={(event) => setTo(event.target.value)}>
					{agents.map((character) => (
						<option key={character.id} value={character.id}>
							{character.role === "coordinator" ? `${character.name} (coordinator)` : character.name}
						</option>
					))}
				</select>
				<span>to look into this thread</span>
			</label>
			<textarea
				className="aw-conv-input aw-slack-input"
				aria-label="Anything to add"
				placeholder="Anything to add (optional): what to find out, who to ask"
				rows={2}
				value={note}
				onChange={(event) => setNote(event.target.value)}
			/>
			<div className="aw-slack-form-foot">
				<span className="aw-slack-note">
					A message to {chosen?.name ?? "the agent"} with a link to the thread. Nothing is posted in Slack.
				</span>
				<button type="button" className="aw-button" onClick={onDone}>
					Cancel
				</button>
				<button type="submit" className="aw-button aw-button-strong" disabled={progress?.state === "sending"}>
					{progress?.state === "sending" ? "Asking\u2026" : "Ask"}
				</button>
			</div>
		</form>
	);
}

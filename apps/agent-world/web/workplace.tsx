import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { CommandResult, MailThread, WorkplaceThread, WorldSnapshot } from "../src/world.js";
import { sleeperCharacter } from "./game/layout.js";
import { EmbeddedConversation } from "./overlay/conversation/conversation-panel.js";
import { conversationPanel } from "./overlay/conversation/panel-state.js";
import { Markdown, TranscriptAuthor } from "./overlay/conversation/transcript.js";
import { activity } from "./overlay/interface/model.js";
import { useWindowFocus } from "./use-window-focus.js";
import { Org } from "./workplace-org.js";
import { ChatPeople, PersonAvatar, PersonName, PersonProfile, sessionStatus } from "./workplace-people.js";
import { worldStore } from "./world-store.js";
import "./workplace.css";

const api = window.agentWorld;
const store = worldStore(api);
conversationPanel.connect(api);
document.body.classList.add("workplace");
document.title = "Workplace";
const drafts = new Map<string, string>();
const date = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Icon({
	name,
}: {
	name:
		| "chat"
		| "mail"
		| "world"
		| "search"
		| "compose"
		| "tools"
		| "inbox"
		| "sent"
		| "activity"
		| "moon"
		| "sun"
		| "org";
}) {
	const paths = {
		org: "M9 3h6v5H9V3Z M3 16h6v5H3v-5Z M15 16h6v5h-6v-5Z M12 8v4 M6 16v-4h12v4",
		sent: "m3 4 18 8-18 8 4-8-4-8Z M7 12h14",
		activity: "M3 12h4l3-8 4 16 3-8h4",
		moon: "M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z",
		sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
		chat: "M5 4h14v12H9l-4 4V4Z M9 8h6 M9 12h4",
		mail: "M3 5h18v14H3V5Z M3 6l9 7 9-7",
		world: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z",
		search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z M15 15l5 5",
		compose: "m5 16-1 4 4-1L20 7l-3-3L5 16Z M14 7l3 3",
		tools: "m8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16",
		inbox: "m3 14 3-9h12l3 9v5H3v-5Z M3 14h5l2 3h4l2-3h5",
	};
	return (
		<svg
			className="wp-icon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d={paths[name]} />
		</svg>
	);
}

function channelUnreads(world: WorldSnapshot) {
	const counts = new Map((world.operatorMail ?? []).map((thread) => [thread.id, thread.unread]));
	return new Map(
		(world.workplace?.threads ?? [])
			.filter((thread) => thread.kind === "channel" && thread.participants.includes("operator"))
			.map((thread) => [thread.id, counts.get(thread.id) ?? 0]),
	);
}

function inboxThreads(world: WorldSnapshot) {
	const channels = new Set(
		world.workplace?.threads.filter((thread) => thread.kind === "channel").map((thread) => thread.id),
	);
	return (world.operatorMail ?? []).filter((thread) => !channels.has(thread.id));
}

function Workplace() {
	const world = useSyncExternalStore(store.subscribe, store.get);
	const [dark, setDark] = useState(() => {
		try {
			const saved = localStorage.getItem("workplace-appearance");
			if (saved) return saved === "dark";
		} catch {
			/* Storage can be disabled; the switch still works for this window. */
		}
		return matchMedia("(prefers-color-scheme: dark)").matches;
	});
	const toggleAppearance = () => {
		setDark(!dark);
		try {
			localStorage.setItem("workplace-appearance", dark ? "light" : "dark");
		} catch {
			/* An unavailable preference store does not block changing appearance. */
		}
	};
	const initialView = new URLSearchParams(location.search).get("workplace");
	const [view, setView] = useState(initialView === "org" ? "org" : initialView === "mail" ? "mail" : "chat");
	const [orgVisited, setOrgVisited] = useState(initialView === "org");
	const [requestedDM, setRequestedDM] = useState<{ id: string; key: string }>();
	const openDM = (id: string) => {
		setRequestedDM({ id, key: crypto.randomUUID() });
		setView("chat");
		history.replaceState(null, "", "?workplace=chat");
	};
	const unread = world ? inboxThreads(world).reduce((sum, thread) => sum + thread.unread, 0) : 0;
	const unreadChat = world
		? world.characters.filter((person) => person.facts?.unseen).length +
			[...channelUnreads(world).values()].filter((count) => count > 0).length
		: 0;
	return (
		<div className={`wp-app wp-${view === "org" ? "org-view" : view}`} data-appearance={dark ? "dark" : "light"}>
			<nav className="wp-rail" aria-label="Applications">
				<a className="wp-brand" href="?" title="Back to Agent World">
					pi
				</a>
				<button
					type="button"
					aria-label="Chat"
					aria-description={`${unreadChat} unread conversations`}
					aria-pressed={view === "chat"}
					onClick={() => {
						setView("chat");
						history.replaceState(null, "", "?workplace=chat");
					}}
				>
					<span className="wp-rail-icon">
						<Icon name="chat" />
					</span>
					Chat{unreadChat > 0 && <b aria-hidden="true">{unreadChat}</b>}
				</button>
				<button
					type="button"
					aria-label="Mail"
					aria-description={`${unread} unread messages`}
					aria-pressed={view === "mail"}
					onClick={() => {
						setView("mail");
						history.replaceState(null, "", "?workplace=mail");
					}}
				>
					<span className="wp-rail-icon">
						<Icon name="mail" />
					</span>
					Mail{unread > 0 && <b>{unread}</b>}
				</button>
				<button
					type="button"
					aria-label="Org"
					aria-pressed={view === "org"}
					onClick={() => {
						setOrgVisited(true);
						setView("org");
						history.replaceState(null, "", "?workplace=org");
					}}
				>
					<span className="wp-rail-icon">
						<Icon name="org" />
					</span>
					Org
				</button>
				<button
					type="button"
					className="wp-appearance-toggle"
					aria-label="Theme: dark mode"
					aria-pressed={dark}
					title={dark ? "Switch to light mode" : "Switch to dark mode"}
					onClick={toggleAppearance}
				>
					<span className="wp-rail-icon">
						<Icon name={dark ? "sun" : "moon"} />
					</span>
					Theme
				</button>
				<a className="wp-world-link" href="?">
					<Icon name="world" />
					World
				</a>
				<span className="wp-avatar" title="Signed in as operator">
					You
				</span>
			</nav>
			<div className="wp-workspace">
				<header className="wp-topbar">
					<strong>
						Workplace <span> / {view === "chat" ? "Conversations" : view === "org" ? "Organizations" : "Mail"}</span>
					</strong>
					<span className={world?.connected ? "wp-connected" : "wp-offline"}>
						{world ? (world.connected ? "Runtime connected" : "Disconnected · last known state") : "Connecting…"}
					</span>
				</header>
				{!world ? (
					<div className="wp-empty">Loading the workplace…</div>
				) : (
					<div className="wp-surface" inert={!world.connected}>
						<div hidden={view !== "chat"}>
							<Chat world={world} active={view === "chat"} requestedDM={requestedDM} />
						</div>
						<div hidden={view !== "mail"}>
							<Mail world={world} active={view === "mail"} />
						</div>
						{orgVisited && (
							<div hidden={view !== "org"}>
								<Org world={world} active={view === "org"} openDM={openDM} />
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

function Chat({
	world,
	active,
	requestedDM,
}: {
	world: WorldSnapshot;
	active: boolean;
	requestedDM?: { id: string; key: string };
}) {
	const [selection, setSelection] = useState<{ kind: "dm" | "channel"; id: string }>();
	const [filter, setFilter] = useState("");
	const [showTools, setShowTools] = useState(false);
	const [profile, setProfile] = useState<{ id: string; name: string }>();
	const profileTrigger = useRef<HTMLElement | null>(null);
	const consumedDM = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (active && requestedDM && consumedDM.current !== requestedDM.key) {
			consumedDM.current = requestedDM.key;
			setSelection({ kind: "dm", id: requestedDM.id });
			setProfile(undefined);
		}
	}, [active, requestedDM]);
	const closeProfile = () => {
		setProfile(undefined);
		if (profileTrigger.current?.isConnected) profileTrigger.current.focus();
	};
	const openDM = (id: string) => {
		setSelection({ kind: "dm", id });
		setProfile(undefined);
	};
	const channels = world.workplace?.threads.filter((thread) => thread.kind === "channel") ?? [];
	const unreads = channelUnreads(world);
	const selectedChannel = channels.find((thread) => selection?.kind === "channel" && thread.id === selection.id);
	const sleeping = world.dormant?.filter((agent) => !agent.retiredAt) ?? [];
	const sleeper = world.dormant?.find((agent) => selection?.kind === "dm" && agent.id === selection.id);
	const person =
		world.characters.find((agent) => selection?.kind === "dm" && agent.id === selection.id) ??
		(sleeper ? sleeperCharacter(sleeper) : undefined);
	const matches = (name: string) => name.toLowerCase().includes(filter.toLowerCase());
	return (
		<ChatPeople.Provider
			value={{
				world,
				openDM,
				openProfile: (id, name, trigger) => {
					profileTrigger.current = trigger;
					setProfile({ id, name });
				},
			}}
		>
			<div className="wp-chat-layout">
				<aside className="wp-chat-sidebar">
					<div className="wp-sidebar-heading">
						<span className="wp-eyebrow">WORKSPACE</span>
						<h1>Your organization</h1>
						<p>{world.characters.length} active sessions</p>
					</div>
					<label className="wp-find">
						<Icon name="search" />
						<input
							aria-label="Find a channel or agent"
							placeholder="Find a channel or agent"
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
						/>
					</label>
					<h2>
						Channels <span>{channels.length}</span>
					</h2>
					{channels
						.filter((thread) => matches(thread.subject))
						.map((thread) => (
							<button
								type="button"
								className="wp-channel"
								data-unread={(unreads.get(thread.id) ?? 0) > 0}
								aria-label={`# ${thread.subject}`}
								aria-description={`${unreads.get(thread.id) ?? 0} unread messages`}
								key={thread.id}
								aria-pressed={selectedChannel?.id === thread.id}
								onClick={() => setSelection({ kind: "channel", id: thread.id })}
							>
								<span>#</span>
								<span>{thread.subject}</span>
								{(unreads.get(thread.id) ?? 0) > 0 && (
									<b className="wp-unread-count" aria-hidden="true">
										{unreads.get(thread.id)}
									</b>
								)}
							</button>
						))}
					{!channels.length && (
						<p className="wp-sidebar-note">Team channels appear here when the runtime creates them.</p>
					)}
					<h2>
						Direct messages <span>{world.characters.length}</span>
					</h2>
					{world.characters
						.filter((agent) => matches(agent.name))
						.map((agent) => (
							<div
								className="wp-dm"
								key={agent.id}
								data-selected={person?.id === agent.id}
								data-unread={!!agent.facts?.unseen}
							>
								<PersonAvatar
									id={agent.id}
									name={agent.name}
									className={`wp-person-icon wp-status-${agent.facts?.status ?? "idle"}`}
								/>
								<button
									type="button"
									className="wp-dm-link"
									aria-description={agent.facts?.unseen ? "Unread update" : undefined}
									aria-pressed={person?.id === agent.id}
									onClick={() => openDM(agent.id)}
								>
									<span className="wp-dm-summary">
										<strong>{agent.name}</strong>
										<small>{agent.facts?.title ?? activity(agent)}</small>
									</span>
									{agent.facts?.unseen && <span className="wp-unread-dot" aria-hidden="true" />}
									{agent.facts?.asking && <b className="wp-needs">?</b>}
								</button>
							</div>
						))}
					{sleeping.length > 0 && (
						<details className="wp-sleepers">
							<summary>Sleeping agents ({sleeping.length})</summary>
							{sleeping
								.filter((agent) => matches(agent.name))
								.map((agent) => (
									<button
										type="button"
										key={agent.id}
										aria-pressed={person?.id === agent.id}
										onClick={() => setSelection({ kind: "dm", id: agent.id })}
									>
										{agent.name}
										<small>Asleep · history only</small>
									</button>
								))}
						</details>
					)}
				</aside>
				<main className="wp-chat-main">
					{person ? (
						<>
							<header className="wp-conversation-header">
								<PersonAvatar
									id={person.id}
									name={person.name}
									className={`wp-header-avatar wp-status-${person.facts?.status ?? "idle"}`}
								/>
								<div className="wp-header-person">
									<h1>
										<PersonName id={person.id} name={person.name} />
									</h1>
									<p>
										<span className={`wp-dot wp-status-${person.facts?.status ?? "idle"}`} />
										{sleeper?.retiredAt
											? "Former member \u00b7 history only"
											: sleeper
												? "Asleep \u00b7 history only"
												: sessionStatus(person)}
										{person.facts?.title ? ` · ${person.facts.title}` : ""}
									</p>
								</div>
								<button
									type="button"
									className="wp-tool-toggle"
									aria-label="Show tool calls"
									aria-pressed={showTools}
									onClick={() => setShowTools(!showTools)}
									title={showTools ? "Hide tool calls" : "Show tool calls"}
								>
									<Icon name="tools" />
									<span>Tool calls</span>
									<span className="wp-switch" aria-hidden="true" />
								</button>
							</header>
							{person.facts?.task && (
								<div className="wp-session-context">
									<span className="wp-task-dot" />
									<span>
										Focused on <strong>{person.facts.task.title}</strong>
									</span>
									<span className="wp-context-label">{sleeper ? "Session history" : "Live session"}</span>
								</div>
							)}
							<div className="wp-session">
								<TranscriptAuthor.Provider
									value={(speaker, name) => (
										<>
											<PersonAvatar
												id={speaker === "user" ? "operator" : person.id}
												name={name}
												className="wp-transcript-avatar"
											/>
											<PersonName
												id={speaker === "user" ? "operator" : person.id}
												name={name}
												className="aw-conv-name"
											/>
										</>
									)}
								>
									{active && <EmbeddedConversation character={person} store={store} showTools={showTools} />}
								</TranscriptAuthor.Provider>
							</div>
						</>
					) : selectedChannel ? (
						<>
							<header className="wp-conversation-header">
								<div>
									<h1># {selectedChannel.subject}</h1>
									<p>{selectedChannel.participants.length} participants · Team channel</p>
								</div>
								<span className="wp-session-label">Shared conversation</span>
							</header>
							{active && <ThreadPane key={selectedChannel.id} id={selectedChannel.id} channel={selectedChannel} />}
						</>
					) : (
						<div className="wp-empty">
							<span className="wp-empty-icon">
								<Icon name="chat" />
							</span>
							<h1>A direct line to your organization</h1>
							<p>
								Choose an agent to work in its live Pi session.
								<br />
								Choose a channel to read the team's shared conversation.
							</p>
							{selection && <p>The selected person or channel is no longer available.</p>}
						</div>
					)}
				</main>
				{active && profile && <PersonProfile key={profile.id} {...profile} onClose={closeProfile} />}
			</div>
		</ChatPeople.Provider>
	);
}

function Mail({ world, active }: { world: WorldSnapshot; active: boolean }) {
	const [folder, setFolder] = useState("inbox");
	const [selected, setSelected] = useState<string>();
	const [query, setQuery] = useState("");
	const [compose, setCompose] = useState(false);
	const [recipient, setRecipient] = useState("");
	const [delivery, setDelivery] = useState<string>();
	const [unreadOnly, setUnreadOnly] = useState(false);
	const threads = inboxThreads(world);
	const deliveries = (world.mail ?? []).filter((item) => folder !== "sent" || item.from === "operator");
	const item = deliveries.find((mail) => mail.id === delivery);
	const unread = threads.reduce((sum, thread) => sum + thread.unread, 0);
	const needle = query.toLowerCase();
	const matchingThreads = threads.filter(
		(thread) => thread.subject.toLowerCase().includes(needle) && (!unreadOnly || thread.unread > 0),
	);
	const matchingDeliveries = deliveries.filter((mail) =>
		`${mail.fromName} ${mail.toName} ${mail.body}`.toLowerCase().includes(needle),
	);
	return (
		<div className="wp-mail-layout">
			<aside className="wp-mail-sidebar">
				<h1>
					<Icon name="mail" />
					Mail
				</h1>
				<button type="button" className="wp-compose" onClick={() => setCompose(true)}>
					<Icon name="compose" />
					Compose
				</button>
				{(
					[
						["inbox", "Inbox", "inbox"],
						["sent", "Sent", "sent"],
						["traffic", "Activity", "activity"],
					] as const
				).map(([key, title, icon]) => (
					<button
						type="button"
						key={key}
						aria-pressed={folder === key}
						onClick={() => {
							setFolder(key);
							setDelivery(undefined);
						}}
					>
						<span>
							<Icon name={icon} />
							{title}
						</span>
						{key === "inbox" && unread > 0 && <b>{unread}</b>}
					</button>
				))}
				<p>
					Mail is asynchronous correspondence.
					<br />
					Sending here does not redirect an agent's current turn.
				</p>
			</aside>
			<main className="wp-mail-main">
				<header className="wp-mail-toolbar">
					<label className="wp-mail-search">
						<Icon name="search" />
						<input
							aria-label="Search mail"
							placeholder={folder === "inbox" ? "Search conversation subjects" : "Search delivery records"}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
					</label>
					{folder === "inbox" && (
						<button
							type="button"
							className="wp-unread-filter"
							aria-pressed={unreadOnly}
							onClick={() => setUnreadOnly(!unreadOnly)}
						>
							Unread
						</button>
					)}
					<span>
						Signed as <strong>you</strong>
					</span>
				</header>
				<div className="wp-mail-columns">
					<section className="wp-mail-list" aria-label={folder === "inbox" ? "Inbox" : "Delivery log"}>
						<div className="wp-list-title">
							<h2>{folder === "inbox" ? "Inbox" : folder === "sent" ? "Sent deliveries" : "Activity"}</h2>
							<span>
								{folder === "inbox"
									? `${matchingThreads.length} conversations`
									: `${matchingDeliveries.length} records`}
							</span>
						</div>
						{folder === "inbox"
							? matchingThreads.map((thread) => (
									<button
										type="button"
										className={`wp-mail-row ${thread.unread ? "wp-unread" : ""}`}
										key={thread.id}
										aria-pressed={selected === thread.id}
										onClick={() => setSelected(thread.id)}
									>
										<span className="wp-mail-row-top">
											<strong>
												{thread.unread > 0 && <span className="wp-unread-dot" aria-hidden="true" />}
												{thread.subject}
											</strong>
											<time>{date(thread.lastAt)}</time>
										</span>
										<small>{thread.unread ? `${thread.unread} unread messages` : "Read conversation"}</small>
									</button>
								))
							: matchingDeliveries.map((mail) => (
									<button
										type="button"
										className="wp-mail-row"
										key={mail.id}
										aria-pressed={delivery === mail.id}
										onClick={() => setDelivery(mail.id)}
									>
										<span className="wp-mail-row-top">
											<strong>
												{mail.fromName} → {mail.toName}
											</strong>
											<time>{date(mail.sentAt)}</time>
										</span>
										<p>{mail.body}</p>
										<small>{mail.state}</small>
									</button>
								))}
						{(folder === "inbox" ? !matchingThreads.length : !matchingDeliveries.length) && (
							<p className="wp-list-empty">
								{query || unreadOnly ? "No matching conversations." : "No mail here yet."}
							</p>
						)}
					</section>
					<section className="wp-mail-reader" aria-label="Message reader">
						{folder === "inbox" && selected ? (
							active && <ThreadPane key={selected} id={selected} />
						) : item && folder !== "inbox" ? (
							<article className="wp-delivery">
								<span className="wp-eyebrow">DELIVERY RECORD · READ ONLY</span>
								<h1>
									{item.fromName} → {item.toName}
								</h1>
								<p>
									{new Date(item.sentAt).toLocaleString()} · {item.state}
								</p>
								<div className="wp-delivery-body">{item.body}</div>
								{item.reason && <p role="status">{item.reason}</p>}
								<p className="wp-muted">
									This is a delivery record, not a complete thread. Reply from your Inbox when you are a participant.
								</p>
							</article>
						) : (
							<div className="wp-empty">
								<span className="wp-empty-icon">
									<Icon name="mail" />
								</span>
								<h1>Room for a longer conversation</h1>
								<p>
									Choose a message to read its thread.
									<br />
									Replies go to everyone in that conversation.
								</p>
							</div>
						)}
					</section>
				</div>
			</main>
			{compose && (
				<Compose world={world} recipient={recipient} setRecipient={setRecipient} close={() => setCompose(false)} />
			)}
		</div>
	);
}

function Messages({
	thread,
	channel,
	followLink,
	unreadAfter,
}: {
	thread: MailThread;
	channel: boolean;
	unreadAfter?: number;
	followLink: (author: string, href: string, file: boolean) => void;
}) {
	const firstUnread =
		unreadAfter === undefined
			? undefined
			: thread.messages.find((message) => message.seq > unreadAfter && message.from !== "operator")?.seq;
	return thread.messages.map((message) => (
		<Fragment key={message.seq}>
			{message.seq === firstUnread && (
				<div className="wp-unread-divider">
					<span aria-hidden="true">New messages</span>
					<hr aria-label="New messages" />
				</div>
			)}
			<article className="wp-message">
				<PersonAvatar
					id={message.from}
					name={message.from === "operator" ? "You" : message.name}
					className="wp-message-avatar"
				/>
				<div className="wp-message-content">
					<header>
						<strong>
							<PersonName id={message.from} name={message.from === "operator" ? "You" : message.name} />
						</strong>
						<time dateTime={new Date(message.at).toISOString()} title={new Date(message.at).toLocaleString()}>
							{channel
								? new Date(message.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
								: new Date(message.at).toLocaleString(undefined, {
										month: "short",
										day: "numeric",
										hour: "numeric",
										minute: "2-digit",
									})}
						</time>
					</header>
					{!channel && (
						<p className="wp-message-to">
							to{" "}
							{thread.participants
								.filter((person) => person.id !== message.from)
								.map((person) => (person.id === "operator" ? "you" : person.name))
								.join(", ")}
						</p>
					)}
					<div className="wp-message-body">
						{channel ? (
							<Markdown text={message.body} onLink={(href, file) => followLink(message.from, href, file)} />
						) : (
							message.body
						)}
					</div>
				</div>
			</article>
		</Fragment>
	));
}

function ThreadPane({ id, channel }: { id: string; channel?: WorkplaceThread }) {
	const [thread, setThread] = useState<MailThread>();
	const [draft, setDraft] = useState(drafts.get(id) ?? "");
	const [pending, setPending] = useState(false);
	const [changingMembership, setChangingMembership] = useState(false);
	const [error, setError] = useState("");
	const [note, setNote] = useState("");
	const mounted = useRef(true);
	const messages = useRef<HTMLDivElement>(null);
	const followLatest = useRef(!!channel);
	const attemptedSeq = useRef(0);
	const focused = useWindowFocus();
	const [unreadAfter, setUnreadAfter] = useState<number>();
	useLayoutEffect(() => {
		if (thread && followLatest.current && messages.current) messages.current.scrollTop = messages.current.scrollHeight;
	}, [thread]);
	const read = useCallback(async () => {
		setPending(true);
		setError("");
		try {
			const result = await (channel ? api.readWorkplaceThread(id) : api.readThread(id));
			if (!mounted.current) return;
			if (result.ok) {
				setThread(result.thread);
				const cursor = result.thread.readUpTo;
				if (
					channel &&
					cursor !== undefined &&
					result.thread.messages.some((message) => message.seq > cursor && message.from !== "operator")
				)
					setUnreadAfter((before) => before ?? cursor);
			} else setError(result.reason);
		} catch (failure) {
			if (mounted.current) setError(String(failure));
		} finally {
			if (mounted.current) setPending(false);
		}
	}, [id, channel]);
	// Each instance owns a single thread; opening it reads only that thread's displayed sequence.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the parent's key owns opening reads; channel updates use the focused follow-latest gate
	useEffect(() => {
		mounted.current = true;
		void read();
		return () => {
			mounted.current = false;
		};
	}, []);
	const member = thread?.participants.some((person) => person.id === "operator");
	const hasNew = !!channel && channel.lastSeq > (thread?.messages.at(-1)?.seq ?? 0);
	// One refresh per observed sequence; a failed read stays actionable instead of retrying in a loop.
	useEffect(() => {
		if (
			!channel ||
			!thread ||
			!hasNew ||
			pending ||
			changingMembership ||
			!focused ||
			!followLatest.current ||
			attemptedSeq.current >= channel.lastSeq
		)
			return;
		attemptedSeq.current = channel.lastSeq;
		void read();
	}, [channel, thread, hasNew, pending, changingMembership, focused, read]);
	const changeMembership = async (joined: boolean) => {
		setChangingMembership(true);
		setError("");
		setNote("");
		try {
			const receipt = await api.setChannelMembership(id, joined);
			if (!mounted.current) return;
			if (!receipt.ok) setError(receipt.reason ?? "Channel membership could not be changed.");
			else {
				setNote(joined ? "You joined this channel." : "You left this channel. You can still preview its messages.");
				if (!joined) setUnreadAfter(undefined);
				await read();
			}
		} catch (failure) {
			if (mounted.current) setError(String(failure));
		} finally {
			if (mounted.current) setChangingMembership(false);
		}
	};
	const followLink = async (author: string, href: string, file: boolean) => {
		try {
			let result: CommandResult | undefined;
			if (file) {
				const world = store.get();
				const cwd =
					world?.characters.find((person) => person.id === author)?.facts?.cwd ??
					world?.dormant?.find((person) => person.id === author)?.cwd;
				result = await api.openFile?.(href, cwd ?? "");
			} else result = await api.openLink?.(href);
			if (mounted.current && !result?.ok) setError(result?.reason ?? "This window cannot open links.");
		} catch (failure) {
			if (mounted.current) setError(String(failure));
		}
	};
	const send = async () => {
		if (pending || changingMembership || !member || thread?.closed || !draft.trim()) return;
		setPending(true);
		setError("");
		setNote("");
		try {
			const receipt = await api.replyThread(id, draft);
			if (receipt.ok) drafts.delete(id);
			if (!mounted.current) return;
			if (!receipt.ok) setError(receipt.reason ?? "The reply failed.");
			else {
				setDraft("");
				followLatest.current = true;
				setNote(`${channel ? "Post" : "Reply"} ${receipt.stage}.`);
				await read();
			}
		} catch (failure) {
			if (mounted.current) setError(String(failure));
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	return (
		<article className={`wp-thread${channel ? " wp-thread-channel" : ""}`}>
			<header className="wp-thread-header">
				{!channel && <h1>{thread?.subject ?? "Reading conversation…"}</h1>}
				<p>
					{!channel && <span className="wp-inbox-tag">Inbox</span>}
					{thread?.participants.map((person, index) => (
						<span key={person.id}>
							{index > 0 && ", "}
							<PersonName id={person.id} name={person.id === "operator" ? "You" : person.name} />
						</span>
					))}
				</p>
				<button
					type="button"
					disabled={pending || changingMembership}
					onClick={() => {
						followLatest.current = !!channel;
						void read();
					}}
				>
					{pending ? "Reading..." : "Read latest"}
				</button>
				{channel && member && !thread?.closed && (
					<details className="wp-channel-menu">
						<summary aria-label="Joined: channel membership">
							Joined <span aria-hidden="true">⌄</span>
						</summary>
						<div>
							<p>You're a member of this channel.</p>
							<button
								type="button"
								disabled={changingMembership || pending}
								onClick={() => void changeMembership(false)}
							>
								Leave channel
							</button>
						</div>
					</details>
				)}
				{hasNew && !pending && (
					<button
						type="button"
						className="wp-new-posts"
						onClick={() => {
							followLatest.current = true;
							void read();
						}}
					>
						New messages - jump to latest
					</button>
				)}
			</header>
			<div
				className="wp-thread-messages"
				ref={messages}
				onScroll={() => {
					const el = messages.current;
					if (el) followLatest.current = el.scrollHeight - el.clientHeight - el.scrollTop < 24;
				}}
			>
				{!thread && pending && <p role="status">Reading conversation...</p>}
				{thread && (
					<Messages
						thread={thread}
						channel={!!channel}
						unreadAfter={channel ? unreadAfter : undefined}
						followLink={(author, href, file) => void followLink(author, href, file)}
					/>
				)}
				{error && <p role="alert">{error}</p>}
				{note && <p role="status">{note}</p>}
			</div>
			{thread &&
				(thread.closed ? (
					<p className="wp-thread-note">This conversation is closed.</p>
				) : !member ? (
					<div className="wp-channel-preview">
						<div>
							<h2>{channel ? `You're previewing # ${channel.subject}` : "You are not a participant"}</h2>
							<p>
								{channel
									? "Join to take part in the conversation. Previewing does not change anyone's read status."
									: "Only participants can reply to this conversation."}
							</p>
						</div>
						{channel && (
							<button
								type="button"
								className="wp-primary"
								disabled={changingMembership || pending}
								onClick={() => void changeMembership(true)}
							>
								{changingMembership ? "Joining..." : "Join channel"}
							</button>
						)}
					</div>
				) : (
					<form
						className="wp-thread-compose"
						onSubmit={(e) => {
							e.preventDefault();
							void send();
						}}
					>
						<label>
							{channel ? "Post to channel as operator" : "Reply to everyone"}
							<textarea
								aria-label={channel ? "Post to channel" : "Reply to everyone"}
								placeholder={channel ? "Write to this channel…" : "Write your reply…"}
								value={draft}
								disabled={pending || changingMembership}
								onKeyDown={(event) => {
									if (
										event.key === "Enter" &&
										!event.nativeEvent.isComposing &&
										(event.metaKey || event.ctrlKey || (channel && !event.shiftKey))
									) {
										event.preventDefault();
										void send();
									}
								}}
								onChange={(e) => {
									setDraft(e.target.value);
									drafts.set(id, e.target.value);
								}}
							/>
						</label>
						<div className="wp-compose-footer">
							<span>{channel ? "Enter to send · Shift + Enter for a new line" : "⌘ / Ctrl + Enter to send"}</span>
							<button className="wp-primary" type="submit" disabled={pending || changingMembership || !draft.trim()}>
								{channel ? "Post message" : "Send reply"}
								<span aria-hidden="true"> ↗</span>
							</button>
						</div>
					</form>
				))}
		</article>
	);
}

function Compose({
	world,
	close,
	recipient,
	setRecipient,
}: {
	world: WorldSnapshot;
	close: () => void;
	recipient: string;
	setRecipient: (id: string) => void;
}) {
	const people = [...world.characters, ...(world.dormant ?? []).filter((person) => !person.retiredAt)];
	const to = recipient || people[0]?.id || "";
	const [body, setBody] = useState(drafts.get("compose") ?? "");
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState("");
	const [sent, setSent] = useState(false);
	const send = async () => {
		setPending(true);
		setStatus("");
		try {
			const result = await api.sendMail(to, body);
			if (result.ok) {
				setSent(true);
				drafts.delete("compose");
				setStatus(`Mail ${result.stage}.${result.note ? ` ${result.note}` : ""}`);
			} else setStatus(result.reason ?? "Mail failed.");
		} catch (failure) {
			setStatus(String(failure));
		} finally {
			setPending(false);
		}
	};
	return (
		<section className="wp-compose-window" role="dialog" aria-label="New message">
			<header>
				<strong>New message</strong>
				<button type="button" disabled={pending} onClick={close} aria-label="Close new message">
					×
				</button>
			</header>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void send();
				}}
			>
				<label>
					To
					<select
						aria-label="Mail recipient"
						value={to}
						disabled={pending || sent}
						onChange={(e) => setRecipient(e.target.value)}
					>
						{people.map((person) => (
							<option key={person.id} value={person.id}>
								{person.name}
							</option>
						))}
					</select>
				</label>
				<p className="wp-muted">
					Subject: Message from the operator
					<br />
					Subjects are fixed.
				</p>
				<textarea
					aria-label="Mail body"
					placeholder="Write a message…"
					value={body}
					disabled={pending || sent}
					onChange={(e) => {
						setBody(e.target.value);
						drafts.set("compose", e.target.value);
					}}
				/>
				<p className="wp-muted">Durable mail, signed as you. Sleeping agents receive it when they wake.</p>
				{status && <p role="status">{status}</p>}
				<button type="submit" className="wp-primary" disabled={pending || sent || !to || !body.trim()}>
					{pending ? "Sending…" : sent ? "Sent" : "Send mail"}
				</button>
			</form>
		</section>
	);
}

createRoot(document.getElementById("overlay")!).render(<Workplace />);

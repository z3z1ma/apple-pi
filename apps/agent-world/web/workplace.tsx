import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { CommunicationResult, ConversationInfo } from "../src/communications.js";
import type { Character, WorkplaceThread, WorldSnapshot } from "../src/world.js";
import { FileReferenceCwd, FileReferenceNavigation, type FileReferenceTarget } from "./file-references.js";
import { sleeperCharacter } from "./game/layout.js";
import { EmbeddedConversation } from "./overlay/conversation/conversation-panel.js";
import { conversationPanel } from "./overlay/conversation/panel-state.js";
import { TranscriptAuthor } from "./overlay/conversation/transcript.js";
import { activity } from "./overlay/interface/model.js";
import { ChannelBrowser } from "./workplace-channels.js";
import { WorkplaceCode } from "./workplace-code.js";
import { useWorkplaceMenu, WorkplaceMenuProvider } from "./workplace-context-menu.js";
import { Icon } from "./workplace-icon.js";
import { WorkplaceIssues } from "./workplace-issues.js";
import { channelName, useWorkplaceNames } from "./workplace-names.js";
import { descendants, Org, orgPeople } from "./workplace-org.js";
import { OrganizationNameForm, OrgNameEditor } from "./workplace-org-name.js";
import { ChatPeople, PersonAvatar, PersonName, PersonProfile, sessionStatus } from "./workplace-people.js";
import { PersonActionsButton, usePersonMenu, WorkplacePersonActions } from "./workplace-person-actions.js";
import { usePaneResize } from "./workplace-resize.js";
import { ThreadPane } from "./workplace-thread.js";
import { WorkplaceWorld } from "./workplace-world.js";
import { worldStore } from "./world-store.js";
import "./workplace.css";

const api = window.agentWorld;
const store = worldStore(api);
conversationPanel.connect(api);
document.body.classList.add("workplace");
document.title = "Workplace";
const drafts = new Map<string, string>();
let composeAttempt: { id: string; to: string; body: string; result?: CommunicationResult } | undefined;
const date = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
	const [view, setView] = useState(
		["org", "mail", "code", "issues", "world"].includes(initialView ?? "") ? (initialView ?? "chat") : "chat",
	);
	const [orgVisited, setOrgVisited] = useState(initialView === "org");
	const [codeVisited, setCodeVisited] = useState(initialView === "code");
	const [issuesVisited, setIssuesVisited] = useState(initialView === "issues");
	const [worldVisited, setWorldVisited] = useState(initialView === "world");
	const [codeDirty, setCodeDirty] = useState(false);
	const [terminalCount, setTerminalCount] = useState(0);
	const [fileRequest, setFileRequest] = useState<FileReferenceTarget>();
	const openFileReference = useCallback((target: FileReferenceTarget) => {
		setFileRequest({ ...target });
		setCodeVisited(true);
		setView("code");
		history.replaceState(null, "", "?workplace=code");
	}, []);
	const [planState, setPlanState] = useState({ dirty: false, started: false });
	useEffect(() => {
		const protectDrafts = (event: BeforeUnloadEvent) => {
			if (
				!codeDirty &&
				terminalCount === 0 &&
				!planState.dirty &&
				!document.querySelector(".wp-world-frame[data-world-dirty]") &&
				![...drafts.values()].some(Boolean) &&
				!world?.characters.some((person) => Boolean(conversationPanel.draft(person.id)))
			)
				return;
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", protectDrafts);
		return () => window.removeEventListener("beforeunload", protectDrafts);
	}, [codeDirty, terminalCount, planState.dirty, world]);
	const [requestedDM, setRequestedDM] = useState<{ id: string; key: string }>();
	const [requestedChannel, setRequestedChannel] = useState<{ id: string; key: string }>();
	const openChannel = (id: string) => {
		setRequestedChannel({ id, key: crypto.randomUUID() });
		setView("chat");
		history.replaceState(null, "", "?workplace=chat");
	};
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
		<div
			className={`wp-app wp-${["org", "code", "issues"].includes(view) ? `${view}-view` : view}`}
			data-appearance={dark ? "dark" : "light"}
		>
			<nav className="wp-rail" aria-label="Applications">
				<span className="wp-brand" aria-hidden="true">
					pi
				</span>
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
					aria-label="Code"
					aria-pressed={view === "code"}
					onClick={() => {
						setCodeVisited(true);
						setView("code");
						history.replaceState(null, "", "?workplace=code");
					}}
				>
					<span className="wp-rail-icon">
						<Icon name="code" />
					</span>
					Code
				</button>
				<button
					type="button"
					aria-label="Issues"
					aria-pressed={view === "issues"}
					onClick={() => {
						setIssuesVisited(true);
						setView("issues");
						history.replaceState(null, "", "?workplace=issues");
					}}
				>
					<span className="wp-rail-icon">
						<Icon name="issues" />
					</span>
					Issues
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
				<button
					type="button"
					className="wp-world-link"
					aria-label="World"
					aria-pressed={view === "world"}
					onClick={() => {
						setWorldVisited(true);
						setView("world");
						history.replaceState(null, "", "?workplace=world");
					}}
				>
					<span className="wp-rail-icon">
						<Icon name="world" />
					</span>
					World
				</button>
				<span className="wp-avatar" title="Signed in as operator">
					You
				</span>
			</nav>
			<div className="wp-workspace">
				<header className="wp-topbar">
					<strong>
						Workplace{" "}
						<span>
							{" "}
							/{" "}
							{view === "chat"
								? "Conversations"
								: view === "org"
									? "Organizations"
									: view === "code"
										? "Code"
										: view === "issues"
											? "Issues"
											: view === "world"
												? "World"
												: "Mail"}
						</span>
					</strong>
					<span className={world?.connected ? "wp-connected" : "wp-offline"}>
						{world ? (world.connected ? "Runtime connected" : "Disconnected · last known state") : "Connecting…"}
					</span>
				</header>
				{!world ? (
					<div className="wp-empty">Loading the workplace…</div>
				) : (
					<div className="wp-surface" inert={!world.connected}>
						<FileReferenceNavigation.Provider value={openFileReference}>
							<WorkplacePersonActions world={world}>
								<div hidden={view !== "chat"}>
									<Chat
										world={world}
										active={view === "chat"}
										requestedDM={requestedDM}
										requestedChannel={requestedChannel}
									/>
								</div>
								<div hidden={view !== "mail"}>
									<Mail world={world} active={view === "mail"} />
								</div>
								{orgVisited && (
									<div hidden={view !== "org"}>
										<Org
											world={world}
											active={view === "org"}
											openDM={openDM}
											openChannel={openChannel}
											onPlanChange={setPlanState}
										/>
									</div>
								)}
								{codeVisited && (
									<div hidden={view !== "code"}>
										<WorkplaceCode
											world={world}
											active={view === "code"}
											fileRequest={fileRequest}
											onDirtyChange={setCodeDirty}
											onTerminalCountChange={setTerminalCount}
										/>
									</div>
								)}
								{issuesVisited && (
									<div hidden={view !== "issues"}>
										<WorkplaceIssues world={world} active={view === "issues"} openDM={openDM} />
									</div>
								)}
								{worldVisited && (
									<div hidden={view !== "world"}>
										<WorkplaceWorld active={view === "world"} />
									</div>
								)}
							</WorkplacePersonActions>
						</FileReferenceNavigation.Provider>
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
	requestedChannel,
}: {
	world: WorldSnapshot;
	active: boolean;
	requestedDM?: { id: string; key: string };
	requestedChannel?: { id: string; key: string };
}) {
	useWorkplaceNames();
	const openMenu = useWorkplaceMenu();
	const [renameChannel, setRenameChannel] = useState<{ id: string; name: string; trigger: HTMLElement }>();
	const channelMenu = (
		event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
		channel: Pick<WorkplaceThread, "id">,
	) => {
		const head = /^(?:organization|team):(.+)$/.exec(channel.id)?.[1];
		if (!head) return;
		const trigger = event.currentTarget;
		const name =
			world.characters.find((person) => person.id === head)?.name ??
			world.dormant?.find((person) => person.id === head)?.name ??
			head;
		openMenu(event, [{ label: "Rename", onSelect: () => setRenameChannel({ id: head, name, trigger }) }]);
	};
	const closeChannelRename = () => {
		setRenameChannel(undefined);
		requestAnimationFrame(() => {
			if (renameChannel?.trigger.isConnected) renameChannel.trigger.focus();
		});
	};
	const [selection, setSelection] = useState<{ kind: "dm" | "channel"; id: string }>();
	const [filter, setFilter] = useState("");
	const personMenu = usePersonMenu();
	const [showTools, setShowTools] = useState(false);
	const [profile, setProfile] = useState<{ id: string; name: string }>();
	const layout = useRef<HTMLDivElement>(null);
	const sidebar = usePaneResize({
		label: "Chat sidebar width",
		variable: "--wp-chat-width",
		axis: "x",
		direction: 1,
		min: 190,
		max: (): number => {
			const available = (layout.current?.clientWidth ?? 0) - 326;
			const node = profileSize.pane.current;
			const profileWidth = node && getComputedStyle(node).position !== "absolute" ? node.offsetWidth : 0;
			return available - Math.min(profileWidth, Math.max(0, available - 190));
		},
	});
	const profileSize = usePaneResize({
		label: "Person profile width",
		variable: "--wp-profile-width",
		axis: "x",
		direction: -1,
		min: 280,
		max: (): number => {
			const available = (layout.current?.clientWidth ?? 0) - 320;
			if (profileSize.pane.current && getComputedStyle(profileSize.pane.current).position === "absolute")
				return available;
			return available - 6 - Math.min(sidebar.pane.current?.offsetWidth ?? 0, Math.max(0, available - 286));
		},
		enabled: !!profile && active,
	});
	const profileTrigger = useRef<HTMLElement | null>(null);
	const consumedDM = useRef<string | undefined>(undefined);
	const consumedChannel = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (active && requestedChannel && consumedChannel.current !== requestedChannel.key) {
			consumedChannel.current = requestedChannel.key;
			setSelection({ kind: "channel", id: requestedChannel.id });
			setProfile(undefined);
		}
	}, [active, requestedChannel]);
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
	const [discovering, setDiscovering] = useState(false);
	const [openedChannels, setOpenedChannels] = useState<ConversationInfo[]>([]);
	const snapshotChannels = world.workplace?.threads.filter((thread) => thread.kind === "channel") ?? [];
	const channels = [
		...snapshotChannels,
		...openedChannels
			.filter((thread) => !snapshotChannels.some((item) => item.id === thread.id))
			.map((thread) => ({
				id: thread.id,
				subject: thread.name,
				participants: thread.participants.map((person) => person.id),
				lastSeq: 0,
			})),
	];
	const unreads = channelUnreads(world);
	const selectedChannel = channels.find((thread) => selection?.kind === "channel" && thread.id === selection.id);
	const lasting = orgPeople(world);
	const parents = new Map(lasting.map((person) => [person.character.id, person.parent]));
	const heads = lasting.filter(
		(person) =>
			(!person.parent || !parents.has(person.parent)) && descendants(person.character.id, parents).length >= 4,
	);
	const headIds = new Set(heads.map((person) => person.character.id));
	const direct = world.characters.filter((agent) => !headIds.has(agent.id));
	const sleeping = world.dormant?.filter((agent) => !agent.retiredAt && !headIds.has(agent.id)) ?? [];
	const sleeper = world.dormant?.find((agent) => selection?.kind === "dm" && agent.id === selection.id);
	const person =
		world.characters.find((agent) => selection?.kind === "dm" && agent.id === selection.id) ??
		(sleeper ? sleeperCharacter(sleeper) : undefined);
	const matches = (name: string) => name.toLowerCase().includes(filter.toLowerCase());
	const personRow = (agent: Character, home = false) => (
		<fieldset
			className="wp-dm"
			key={agent.id}
			tabIndex={-1}
			aria-label={agent.name}
			data-selected={person?.id === agent.id}
			data-unread={!!agent.facts?.unseen}
			onContextMenu={(event) => personMenu(event, agent.id)}
		>
			<PersonAvatar
				id={agent.id}
				name={agent.name}
				className={`wp-person-icon wp-status-${agent.facts?.status ?? "idle"}`}
			/>
			<button
				type="button"
				className="wp-dm-link"
				aria-haspopup="menu"
				onKeyDown={(event) => personMenu(event, agent.id)}
				aria-description={agent.facts?.unseen ? "Unread update" : undefined}
				aria-pressed={person?.id === agent.id}
				onClick={() => openDM(agent.id)}
			>
				<span className="wp-dm-summary">
					<span className="wp-dm-name">
						<strong>{agent.name}</strong>
						{!home && agent.facts?.status === "working" && (
							<span className="wp-dm-working" role="img" aria-label="Working" title="Working">
								<Icon name="activity" />
							</span>
						)}
					</span>
					<small>{home ? "Asleep \u00b7 history only" : (agent.facts?.title ?? activity(agent))}</small>
				</span>
				{agent.facts?.unseen && <span className="wp-unread-dot" aria-hidden="true" />}
				{agent.facts?.asking && <b className="wp-needs">?</b>}
			</button>
		</fieldset>
	);
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
			<div className="wp-chat-layout" ref={layout} style={sidebar.style}>
				<aside className="wp-chat-sidebar" ref={sidebar.ref}>
					<div className="wp-sidebar-heading">
						<span className="wp-eyebrow">WORKSPACE</span>
						<OrgNameEditor id="workspace" name="Your organization" defaultName="Your organization" heading="h1" />
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
					<h2 className="wp-channel-heading">
						Channels <span>{channels.length}</span>
						<span className="wp-channel-tools">
							<button
								type="button"
								aria-label="Discover or create channels"
								title="Discover or create channels"
								onClick={() => setDiscovering(true)}
							>
								+
							</button>
						</span>
					</h2>
					{renameChannel && (
						<div className="wp-channel-rename">
							<OrganizationNameForm
								key={renameChannel.id}
								id={renameChannel.id}
								name={renameChannel.name}
								onClose={closeChannelRename}
							/>
						</div>
					)}
					{channels
						.filter((thread) => matches(channelName(thread.id, thread.subject, world)))
						.map((thread) => (
							<button
								type="button"
								className="wp-channel"
								aria-haspopup={/^(organization|team):/.test(thread.id) ? "menu" : undefined}
								onContextMenu={(event) => channelMenu(event, thread)}
								onKeyDown={(event) => channelMenu(event, thread)}
								data-unread={(unreads.get(thread.id) ?? 0) > 0}
								aria-label={`# ${channelName(thread.id, thread.subject, world)}`}
								aria-description={`${unreads.get(thread.id) ?? 0} unread messages`}
								key={thread.id}
								aria-pressed={selectedChannel?.id === thread.id}
								onClick={() => setSelection({ kind: "channel", id: thread.id })}
							>
								<span>#</span>
								<span>{channelName(thread.id, thread.subject, world)}</span>
								{(unreads.get(thread.id) ?? 0) > 0 && (
									<b className="wp-unread-count" aria-hidden="true">
										{unreads.get(thread.id)}
									</b>
								)}
							</button>
						))}
					{!channels.length && <p className="wp-sidebar-note">Discover shared context or create a topic channel.</p>}
					{heads.length > 0 && (
						<section aria-label="VIPs">
							<h2>
								VIPs <span>{heads.length}</span>
							</h2>
							{heads.filter((head) => matches(head.character.name)).map((head) => personRow(head.character, head.home))}
						</section>
					)}
					<h2>
						Direct messages <span>{direct.length}</span>
					</h2>
					{direct.filter((agent) => matches(agent.name)).map((agent) => personRow(agent))}
					{sleeping.length > 0 && (
						<details className="wp-sleepers">
							<summary>Sleeping agents ({sleeping.length})</summary>
							{sleeping
								.filter((agent) => matches(agent.name))
								.map((agent) => (
									<button
										key={agent.id}
										type="button"
										aria-haspopup="menu"
										aria-pressed={person?.id === agent.id}
										onContextMenu={(event) => personMenu(event, agent.id)}
										onKeyDown={(event) => personMenu(event, agent.id)}
										onClick={() => setSelection({ kind: "dm", id: agent.id })}
									>
										{agent.name}
										<small>{"Asleep \u00b7 history only"}</small>
									</button>
								))}
						</details>
					)}
				</aside>
				{sidebar.separator}
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
								<PersonActionsButton id={person.id} />
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
									{active && (
										<FileReferenceCwd.Provider value={person.facts?.cwd}>
											<EmbeddedConversation character={person} store={store} showTools={showTools} />
										</FileReferenceCwd.Provider>
									)}
								</TranscriptAuthor.Provider>
							</div>
						</>
					) : selectedChannel ? (
						<>
							<header className="wp-conversation-header">
								<div>
									<h1
										tabIndex={-1}
										aria-haspopup={/^(organization|team):/.test(selectedChannel.id) ? "menu" : undefined}
										onContextMenu={(event) => channelMenu(event, selectedChannel)}
										onKeyDown={(event) => channelMenu(event, selectedChannel)}
									>
										# {channelName(selectedChannel.id, selectedChannel.subject, world)}
									</h1>
									<p>
										{selectedChannel.participants.length} participants ·{" "}
										{selectedChannel.id.startsWith("organization:")
											? "Organization channel"
											: selectedChannel.id.startsWith("team:")
												? "Direct-report team channel"
												: "Channel"}
									</p>
								</div>
								<span className="wp-session-label">Shared conversation</span>
							</header>
							{active && (
								<ThreadPane
									key={selectedChannel.id}
									id={selectedChannel.id}
									channel={selectedChannel}
									channelLabel={channelName(selectedChannel.id, selectedChannel.subject, world)}
									world={world}
									drafts={drafts}
								/>
							)}
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
				{active && discovering && (
					<ChannelBrowser
						world={world}
						close={() => setDiscovering(false)}
						open={(thread) => {
							setOpenedChannels((previous) => [...previous.filter((item) => item.id !== thread.id), thread]);
							setSelection({ kind: "channel", id: thread.id });
							setProfile(undefined);
							setDiscovering(false);
						}}
					/>
				)}
				{active && profile && (
					<PersonProfile key={profile.id} {...profile} onClose={closeProfile} resize={profileSize} />
				)}
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
	const layout = useRef<HTMLDivElement>(null);
	const sidebar = usePaneResize({
		label: "Mail sidebar width",
		variable: "--wp-mail-sidebar-width",
		axis: "x",
		direction: 1,
		min: 150,
		max: (): number => {
			const columns = list.pane.current?.parentElement;
			const main = columns?.parentElement;
			const chrome = (main?.clientWidth ?? 0) - (columns?.clientWidth ?? 0);
			const available = (layout.current?.clientWidth ?? 0) - chrome - 352;
			return available - Math.min(list.pane.current?.offsetWidth ?? 225, Math.max(0, available - 150));
		},
	});
	const list = usePaneResize({
		label: "Mail list width",
		variable: "--wp-mail-list-width",
		axis: "x",
		direction: 1,
		min: 225,
		max: (): number => (list.pane.current?.parentElement?.clientWidth ?? 0) - 346,
	});
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
		<div className="wp-mail-layout" ref={layout} style={{ ...sidebar.style, ...list.style }}>
			<aside className="wp-mail-sidebar" ref={sidebar.ref}>
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
			</aside>
			{sidebar.separator}
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
					<section ref={list.ref} className="wp-mail-list" aria-label={folder === "inbox" ? "Inbox" : "Delivery log"}>
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
					{list.separator}
					<section className="wp-mail-reader" aria-label="Message reader">
						{folder === "inbox" && selected ? (
							active && <ThreadPane key={selected} id={selected} world={world} drafts={drafts} />
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
	const [attempt, setAttempt] = useState(composeAttempt);
	const to = attempt?.to ?? (recipient || people[0]?.id || "");
	const [body, setBody] = useState(drafts.get("compose") ?? "");
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState(composeAttempt ? "Saved mail attempt; check its original outcome." : "");
	const [sent, setSent] = useState(composeAttempt?.result?.outcome === "applied");
	const [acknowledgeDuplicate, setAcknowledgeDuplicate] = useState(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const unresolved = !!attempt && !["applied", "refused"].includes(attempt.result?.outcome ?? "pending");
	const locked = pending || sent || unresolved;
	const reflect = (result: CommunicationResult, entry: NonNullable<typeof composeAttempt>) => {
		entry.result = result;
		composeAttempt = entry;
		if (result.outcome === "applied" && drafts.get("compose") === entry.body) drafts.delete("compose");
		if (!mounted.current) return;
		setAttempt({ ...entry });
		if (result.outcome === "applied") {
			setSent(true);
			const audience = result.effect?.audience ?? result.effect?.to;
			const names = (ids: string[]) =>
				ids.map((id) => people.find((person) => person.id === id)?.name ?? id).join(", ");
			setStatus(
				`Mail applied.${audience ? ` Addressed: ${names(audience)}.` : ""}${result.effect?.queued?.length ? ` Queued for a later opening: ${names(result.effect.queued)}.` : ""} Publication is not acknowledgment.`,
			);
		} else setStatus(result.reason ?? `Mail ${result.outcome}. Check this attempt before sending again.`);
	};
	const send = async () => {
		if (
			locked ||
			!to ||
			!body.trim() ||
			(composeAttempt && !["applied", "refused"].includes(composeAttempt.result?.outcome ?? "pending"))
		)
			return;
		const entry = { id: crypto.randomUUID(), to, body };
		composeAttempt = entry;
		setAttempt(entry);
		setPending(true);
		setStatus("");
		try {
			reflect(
				await api.communications.sendMail({ attempt: entry.id, to: [to], subject: "Message from the operator", body }),
				entry,
			);
		} catch (failure) {
			reflect({ attempt: entry.id, outcome: "uncertain", reason: `Mail outcome uncertain: ${String(failure)}` }, entry);
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	const recover = async () => {
		if (!attempt || pending) return;
		setPending(true);
		try {
			reflect(await api.communications.status({ attempt: attempt.id }), attempt);
		} catch (failure) {
			if (mounted.current) setStatus(String(failure));
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	const dismiss = () => {
		if (!unresolved) composeAttempt = undefined;
		close();
	};
	return (
		<section className="wp-compose-window" role="dialog" aria-label="New message">
			<header>
				<strong>New message</strong>
				<button type="button" disabled={pending} onClick={dismiss} aria-label="Close new message">
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
						disabled={locked}
						onChange={(e) => {
							setRecipient(e.target.value);
							setAttempt(undefined);
							composeAttempt = undefined;
						}}
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
					disabled={locked}
					onChange={(e) => {
						setBody(e.target.value);
						drafts.set("compose", e.target.value);
					}}
				/>
				<p className="wp-muted">Durable mail, signed as you. Sleeping agents receive it when they wake.</p>
				{status && <p role="status">{status}</p>}
				{attempt && (
					<p className="wp-thread-attempt">
						Mail attempt: {attempt.id} · {attempt.result?.outcome ?? "pending"}{" "}
						<button type="button" disabled={pending} onClick={() => void recover()}>
							Check mail outcome
						</button>
					</p>
				)}
				{attempt?.result?.outcome === "not_recorded" && (
					<div className="wp-communication-restart">
						<p>
							No durable record was found. A disconnected original send could still arrive; a fresh send may duplicate
							it.
						</p>
						<label>
							<input
								type="checkbox"
								checked={acknowledgeDuplicate}
								onChange={(event) => setAcknowledgeDuplicate(event.target.checked)}
							/>
							I understand a fresh attempt may duplicate the original.
						</label>
						<button
							type="button"
							disabled={pending || !acknowledgeDuplicate}
							onClick={() => {
								composeAttempt = undefined;
								setAttempt(undefined);
								setAcknowledgeDuplicate(false);
								setStatus("Draft retained. A new send will use a fresh attempt.");
							}}
						>
							Keep draft and prepare a new mail attempt
						</button>
					</div>
				)}
				<button type="submit" className="wp-primary" disabled={locked || !to || !body.trim()}>
					{pending ? "Sending…" : sent ? "Sent" : "Send mail"}
				</button>
			</form>
		</section>
	);
}

createRoot(document.getElementById("overlay")!).render(
	<WorkplaceMenuProvider>
		<Workplace />
	</WorkplaceMenuProvider>,
);

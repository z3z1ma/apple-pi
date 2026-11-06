import {
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import type { ConversationInfo } from "../src/communications.js";
import type { Character, WorkplaceThread, WorldSnapshot } from "../src/world.js";
import { FileReferenceCwd, FileReferenceNavigation, type FileReferenceTarget } from "./file-references.js";
import { sleeperCharacter } from "./game/layout.js";
import { MentionPeople } from "./overlay/conversation/actions.js";
import { EmbeddedConversation } from "./overlay/conversation/conversation-panel.js";
import { conversationPanel } from "./overlay/conversation/panel-state.js";
import { TranscriptAuthor, TranscriptMessage, type TranscriptMessageInfo } from "./overlay/conversation/transcript.js";
import { activity } from "./overlay/interface/model.js";
import { StoredDrafts } from "./stored-drafts.js";
import { ChannelBrowser } from "./workplace-channels.js";
import { WorkplaceCode } from "./workplace-code.js";
import { Connections } from "./workplace-connections.js";
import { useWorkplaceMenu, WorkplaceMenuProvider } from "./workplace-context-menu.js";
import { DepartureDialog, type DepartureSelection } from "./workplace-departures.js";
import {
	activityItems,
	ChannelHeader,
	ChatNav,
	CustomSections,
	GroupList,
	type OpenThread,
	OrganizationView,
	PinnedThreadList,
	SectionNamer,
	SidebarSection,
	useActivitySeen,
	useSections,
} from "./workplace-desk.js";
import { WorkplaceGit } from "./workplace-git.js";
import { Icon } from "./workplace-icon.js";
import { WorkplaceIssues } from "./workplace-issues.js";
import { muted } from "./workplace-later.js";
import { Mail } from "./workplace-mail.js";
import {
	ActionableMessage,
	ForwardProvider,
	type Reaction,
	ReactionPills,
	toggledReaction,
} from "./workplace-message-actions.js";
import { channelName, useWorkplaceNames } from "./workplace-names.js";
import { descendants, Org, orgPeople } from "./workplace-org.js";
import { OrganizationNameForm, OrgNameEditor } from "./workplace-org-name.js";
import {
	ChatPeople,
	KindBadge,
	PersonAvatar,
	PersonName,
	PersonProfile,
	presenceOf,
	sessionStatus,
} from "./workplace-people.js";
import { PersonActionsButton, usePersonMenu, WorkplacePersonActions } from "./workplace-person-actions.js";
import { usePaneResize } from "./workplace-resize.js";
import { useReviewUpdates } from "./workplace-review-updates.js";
import { WorkplaceReviews } from "./workplace-reviews.js";
import { type AppearanceMode, WorkplaceSettings } from "./workplace-settings.js";
import { QuickSwitcher, type SwitchTarget } from "./workplace-switcher.js";
import { DEFAULT_THEME, THEMES, themeOf, themeVariables } from "./workplace-themes.js";
import { ThreadPane } from "./workplace-thread.js";
import {
	chooseWorkspace,
	currentWorkspace,
	scopeWorld,
	useChosenWorkspace,
	WorkspaceContext,
	workspaceOf,
	workspaces,
	workspaceUnread,
} from "./workplace-workspaces.js";
import { WorkplaceWorld } from "./workplace-world.js";
import { worldStore } from "./world-store.js";
import "./workplace.css";

const api = window.agentWorkplace;
const store = worldStore(api);
conversationPanel.connect(api);
document.body.classList.add("workplace");
document.title = "Workplace";
const drafts = new StoredDrafts("workplace-draft:thread:");

function DraftMark() {
	return (
		<span className="wp-draft-mark" role="img" aria-label="Draft" title="Unsent draft">
			<Icon name="compose" />
		</span>
	);
}

function dmMessageFor(id: string, where: string, canReply: boolean) {
	return function DMMessage({
		message,
		className,
		entry,
		children,
	}: {
		message: TranscriptMessageInfo;
		className: string;
		entry: string;
		children: ReactNode;
	}) {
		const [changed, setChanged] = useState<Reaction[]>();
		const reactions = changed ?? message.reactions ?? [];
		const react = (emoji: string) => {
			const { next, on } = toggledReaction(reactions, emoji);
			void api.communications.react({ message: `entry:${id}:${entry}`, emoji, on }).then((result) => {
				if (result.ok) setChanged(next);
			});
		};
		return (
			<ActionableMessage
				className={className}
				data-entry={entry}
				message={{ author: message.author, at: message.at, text: message.text, where }}
				origin={{ kind: "dm", id }}
				onReply={canReply && message.text.trim() ? (quoted) => conversationPanel.setReplyTo(id, quoted) : undefined}
				react={react}
			>
				{children}
				<ReactionPills reactions={reactions} toggle={react} nameOf={(who) => who} />
			</ActionableMessage>
		);
	};
}

function revealEntry(entry: string, tries = 50) {
	const found = document.querySelector<HTMLElement>(`.wp-session [data-entry="${CSS.escape(entry)}"]`);
	if (!found) {
		if (tries > 0) setTimeout(() => revealEntry(entry, tries - 1), 100);
		return;
	}
	found.scrollIntoView({ block: "center" });
	found.dataset.flash = "true";
	setTimeout(() => delete found.dataset.flash, 2000);
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

function stored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function remember(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {}
}

function useSystemDark(): boolean {
	const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
	useEffect(() => {
		const query = matchMedia("(prefers-color-scheme: dark)");
		const change = () => setDark(query.matches);
		query.addEventListener("change", change);
		return () => query.removeEventListener("change", change);
	}, []);
	return dark;
}

const VIEW_TITLES: Record<string, string> = {
	chat: "Conversations",
	org: "Organizations",
	code: "Code",
	git: "Git",
	reviews: "Reviews",
	issues: "Issues",
	world: "World",
	settings: "Settings",
};

type RailApp = {
	id: string;
	label: string;
	icon: Parameters<typeof Icon>[0]["name"];
	badge?: number;
	description?: string;
};

function RailApps({ apps, view, onSelect }: { apps: RailApp[]; view: string; onSelect(id: string): void }) {
	const box = useRef<HTMLDivElement>(null);
	const itemHeight = useRef(0);
	const [fit, setFit] = useState(apps.length);
	const openMenu = useWorkplaceMenu();
	useEffect(() => {
		const node = box.current;
		if (!node) return;
		const measure = () => {
			const first = node.firstElementChild as HTMLElement | null;
			if (first?.offsetHeight) itemHeight.current = first.offsetHeight;
			if (!itemHeight.current) return;
			const gap = Number.parseFloat(getComputedStyle(node).rowGap) || 0;
			const capacity = Math.floor((node.clientHeight + gap) / (itemHeight.current + gap));
			setFit(capacity >= apps.length ? apps.length : Math.max(0, capacity - 1));
		};
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		measure();
		return () => observer.disconnect();
	}, [apps.length]);
	const hidden = apps.slice(fit);
	const hiddenBadges = hidden.reduce((sum, app) => sum + (app.badge ?? 0), 0);
	return (
		<div className="wp-rail-apps" ref={box}>
			{apps.slice(0, fit).map((app) => (
				<button
					key={app.id}
					type="button"
					aria-label={app.label}
					aria-description={app.description}
					aria-pressed={view === app.id}
					onClick={() => onSelect(app.id)}
				>
					<span className="wp-rail-icon">
						<Icon name={app.icon} />
					</span>
					{app.label}
					{!!app.badge && <b aria-hidden="true">{app.badge}</b>}
				</button>
			))}
			{hidden.length > 0 && (
				<button
					type="button"
					className="wp-rail-more"
					aria-label="More apps"
					aria-description={hidden.map((app) => app.label).join(", ")}
					aria-pressed={hidden.some((app) => app.id === view)}
					onClick={(event) =>
						openMenu(
							event,
							hidden.map((app) => ({
								label: `${view === app.id ? "\u2713 " : ""}${app.label}${app.badge ? ` (${app.badge})` : ""}`,
								onSelect: () => onSelect(app.id),
							})),
						)
					}
				>
					<span className="wp-rail-icon">
						<Icon name={hidden.find((app) => app.id === view)?.icon ?? "more"} />
					</span>
					{hidden.find((app) => app.id === view)?.label ?? "More"}
					{hiddenBadges > 0 && <b aria-hidden="true">{hiddenBadges}</b>}
				</button>
			)}
		</div>
	);
}

function initials(name: string): string {
	const words = name
		.replace(/ organization$/, "")
		.split(/[\s-]+/)
		.filter(Boolean);
	return (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? "pi").slice(0, 2)).toUpperCase();
}

function Workplace() {
	const world = useSyncExternalStore(store.subscribe, store.get);
	const names = useWorkplaceNames();
	const chosenWorkspace = useChosenWorkspace();
	// biome-ignore lint/correctness/useExhaustiveDependencies: organization names change the workspace labels.
	const allWorkspaces = useMemo(() => (world ? workspaces(world) : []), [world, names]);
	const workspace = currentWorkspace(allWorkspaces, chosenWorkspace);
	const scoped = useMemo(() => world && scopeWorld(world, workspace), [world, workspace]);
	const place = useMemo(() => ({ current: workspace, all: allWorkspaces }), [workspace, allWorkspaces]);
	const [mode, setModeState] = useState<AppearanceMode>(() => {
		const saved = stored("workplace-appearance");
		return saved === "dark" || saved === "light" ? saved : "system";
	});
	const systemDark = useSystemDark();
	const dark = mode === "system" ? systemDark : mode === "dark";
	const setMode = (next: AppearanceMode) => {
		setModeState(next);
		remember("workplace-appearance", next === "system" ? null : next);
	};
	const toggleAppearance = () => setMode(dark ? "light" : "dark");
	const [themeId, setThemeId] = useState(() => stored("workplace-theme") ?? DEFAULT_THEME);
	const theme = themeOf(themeId);
	const setTheme = (id: string) => {
		setThemeId(id);
		remember("workplace-theme", id === DEFAULT_THEME ? null : id);
	};

	const themeStyle = useMemo(
		() =>
			theme.id === DEFAULT_THEME
				? undefined
				: (themeVariables(dark ? theme.dark : theme.light, dark) as React.CSSProperties),
		[theme, dark],
	);
	const initialView = new URLSearchParams(location.search).get("workplace");
	const [view, setView] = useState(
		["org", "mail", "code", "git", "reviews", "issues", "world", "settings"].includes(initialView ?? "")
			? (initialView ?? "chat")
			: "chat",
	);
	const [orgVisited, setOrgVisited] = useState(initialView === "org");
	const [codeVisited, setCodeVisited] = useState(initialView === "code");
	const [gitVisited, setGitVisited] = useState(initialView === "git");
	const [reviewsVisited, setReviewsVisited] = useState(initialView === "reviews");
	const [reviewRequest, setReviewRequest] = useState<{ id: string; key: string }>();
	const reviewUpdates = useReviewUpdates(!!world?.connected, workspace?.members);
	const showPersonWorkspace = (people: string[]) => {
		if (people.some((person) => workspace?.members.has(person))) return;
		const home = people.map((person) => workspaceOf(allWorkspaces, person)).find(Boolean);
		if (home) chooseWorkspace(home.id);
	};
	const openReview = (id: string) => {
		showPersonWorkspace([...(reviewUpdates.peopleOf(id) ?? [])].reverse());
		setReviewRequest({ id, key: crypto.randomUUID() });
		setReviewsVisited(true);
		setView("reviews");
		history.replaceState(null, "", "?workplace=reviews");
	};
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
	const brand = useRef<HTMLButtonElement>(null);
	const [leaving, setLeaving] = useState<DepartureSelection & { name: string }>();
	const [leavingOpen, setLeavingOpen] = useState(false);
	const [leavingUnsettled, setLeavingUnsettled] = useState(false);
	useEffect(() => {
		const protectDrafts = (event: BeforeUnloadEvent) => {
			if (
				!codeDirty &&
				terminalCount === 0 &&
				!planState.dirty &&
				!leavingUnsettled &&
				!document.querySelector(".wp-world-frame[data-world-dirty]")
			)
				return;
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", protectDrafts);
		return () => window.removeEventListener("beforeunload", protectDrafts);
	}, [codeDirty, terminalCount, planState.dirty, leavingUnsettled]);
	const [requestedDM, setRequestedDM] = useState<{ id: string; key: string }>();
	const [requestedChannel, setRequestedChannel] = useState<{ id: string; key: string }>();
	const openChannel = (id: string) => {
		setRequestedChannel({ id, key: crypto.randomUUID() });
		setView("chat");
		history.replaceState(null, "", "?workplace=chat");
	};
	const openDM = (id: string) => {
		showPersonWorkspace([id]);
		setRequestedDM({ id, key: crypto.randomUUID() });
		setView("chat");
		history.replaceState(null, "", "?workplace=chat");
	};
	const switchWorkspace = (id: string) => {
		setRequestedDM(undefined);
		setRequestedChannel(undefined);
		chooseWorkspace(id);
	};
	const unread = scoped ? inboxThreads(scoped).reduce((sum, thread) => sum + thread.unread, 0) : 0;
	const openMenu = useWorkplaceMenu();
	const themeMenu = [
		...THEMES.map((each) => ({
			label: `${each.id === theme.id ? "\u2713 " : ""}${each.name}`,
			onSelect: () => setTheme(each.id),
		})),
		{
			label: "All themes and settings\u2026",
			onSelect: () => {
				setView("settings");
				history.replaceState(null, "", "?workplace=settings");
			},
		},
	];
	const silenced = new Set(muted.use().map((item) => item.key));
	const unreadChat = scoped
		? scoped.characters.filter((person) => person.facts?.unseen && !silenced.has(`dm:${person.id}`)).length +
			[...channelUnreads(scoped)].filter(([id, count]) => count > 0 && !silenced.has(`channel:${id}`)).length
		: 0;
	const workspaceMenu = [
		...allWorkspaces.map((each) => {
			const count = world && each.id !== workspace?.id ? workspaceUnread(world, each) : 0;
			return {
				label: `${each.id === workspace?.id ? "\u2713 " : ""}${each.name}${count ? ` (${count})` : ""}`,
				onSelect: () => switchWorkspace(each.id),
			};
		}),
		...(world && workspace && !leaving
			? [
					{
						label: `Leave ${workspace.name}\u2026`,
						onSelect: () => {
							setLeaving({
								id: crypto.randomUUID(),
								trigger: brand.current!,
								name: workspace.name,
								people: orgPeople(world)
									.filter((person) => workspace.members.has(person.character.id))
									.map((person) => ({
										person: person.character.id,
										name: person.character.name,
										manager: person.character.role === "coordinator",
									})),
							});
							setLeavingOpen(true);
						},
					},
				]
			: leaving
				? [{ label: "Leaving progress\u2026", onSelect: () => setLeavingOpen(true) }]
				: []),
	];
	return (
		<div
			className={`wp-app wp-${["org", "code", "git", "reviews", "issues"].includes(view) ? `${view}-view` : view}`}
			data-appearance={dark ? "dark" : "light"}
			data-theme={theme.id}
			style={themeStyle}
		>
			<nav className="wp-rail" aria-label="Applications">
				<button
					ref={brand}
					type="button"
					className="wp-brand"
					aria-label={`Workspace: ${workspace?.name ?? "pi"}. Switch workspace`}
					title={workspace ? `${workspace.name} \u00b7 switch workspace` : undefined}
					disabled={allWorkspaces.length === 0}
					onClick={(event) => openMenu(event, workspaceMenu)}
					onKeyDown={(event) => openMenu(event, workspaceMenu)}
				>
					{workspace ? initials(workspace.name) : "pi"}
				</button>
				<RailApps
					view={view}
					apps={[
						{
							id: "chat",
							label: "Chat",
							icon: "chat",
							badge: unreadChat,
							description: `${unreadChat} unread conversations`,
						},
						{ id: "mail", label: "Mail", icon: "mail", badge: unread, description: `${unread} unread messages` },
						{ id: "org", label: "Org", icon: "org" },
						{ id: "code", label: "Code", icon: "code" },
						{ id: "git", label: "Git", icon: "git" },
						{
							id: "reviews",
							label: "Reviews",
							icon: "review",
							badge: reviewUpdates.updated.size,
							description: `${reviewUpdates.updated.size} updated reviews`,
						},
						{ id: "issues", label: "Issues", icon: "issues" },
					]}
					onSelect={(id) => {
						if (id === "org") setOrgVisited(true);
						if (id === "code") setCodeVisited(true);
						if (id === "git") setGitVisited(true);
						if (id === "reviews") setReviewsVisited(true);
						if (id === "issues") setIssuesVisited(true);
						setView(id);
						history.replaceState(null, "", `?workplace=${id}`);
					}}
				/>
				<button
					type="button"
					className="wp-appearance-toggle"
					aria-label="Theme: dark mode"
					aria-pressed={dark}
					title={`${theme.name}: ${dark ? "switch to light" : "switch to dark"}. Right-click for themes.`}
					onClick={toggleAppearance}
					onContextMenu={(event) => openMenu(event, themeMenu)}
					onKeyDown={(event) => openMenu(event, themeMenu)}
				>
					<span className="wp-rail-icon">
						<Icon name={dark ? "sun" : "moon"} />
					</span>
					Theme
				</button>
				<button
					type="button"
					aria-label="Settings"
					aria-pressed={view === "settings"}
					onClick={() => {
						setView("settings");
						history.replaceState(null, "", "?workplace=settings");
					}}
				>
					<span className="wp-rail-icon">
						<Icon name="settings" />
					</span>
					Settings
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
						{workspace?.name ?? "Workplace"} <span> / {VIEW_TITLES[view] ?? "Mail"}</span>
					</strong>
					<button
						type="button"
						className="wp-topbar-search"
						onClick={() => {
							setView("chat");
							history.replaceState(null, "", "?workplace=chat");
							requestAnimationFrame(() => window.dispatchEvent(new Event("workplace-switcher")));
						}}
					>
						<Icon name="search" />
						<span>Search messages or jump to a person, channel or thread</span>
						<kbd>{"\u2318K"}</kbd>
					</button>
					<span className={world?.connected ? "wp-connected" : "wp-offline"}>
						{world ? (world.connected ? "Runtime connected" : "Disconnected · last known state") : "Connecting…"}
					</span>
				</header>
				{!world || !scoped ? (
					<div className="wp-empty">Loading the workplace…</div>
				) : (
					<div className="wp-surface" inert={!world.connected}>
						<WorkspaceContext.Provider value={place}>
							<FileReferenceNavigation.Provider value={openFileReference}>
								<WorkplacePersonActions world={world}>
									<div hidden={view !== "chat"}>
										<Chat
											key={workspace?.id}
											world={scoped}
											active={view === "chat"}
											requestedDM={requestedDM}
											requestedChannel={requestedChannel}
										/>
									</div>
									<div hidden={view !== "mail"}>
										<Mail key={workspace?.id} world={scoped} active={view === "mail"} drafts={drafts} />
									</div>
									{orgVisited && (
										<div hidden={view !== "org"}>
											<Org
												world={scoped}
												everyone={world}
												root={workspace?.id}
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
												onOpenReview={openReview}
											/>
										</div>
									)}
									{gitVisited && (
										<div hidden={view !== "git"}>
											<WorkplaceGit active={view === "git"} />
										</div>
									)}
									{reviewsVisited && (
										<div hidden={view !== "reviews"}>
											<WorkplaceReviews
												active={view === "reviews"}
												world={world}
												owners={workspace?.members}
												updates={reviewUpdates}
												request={reviewRequest}
											/>
										</div>
									)}
									{issuesVisited && (
										<div hidden={view !== "issues"}>
											<WorkplaceIssues world={world} active={view === "issues"} openDM={openDM} />
										</div>
									)}
									{view === "settings" && (
										<WorkplaceSettings theme={theme} setTheme={setTheme} mode={mode} setMode={setMode} dark={dark}>
											<Connections />
										</WorkplaceSettings>
									)}
									{worldVisited && (
										<div hidden={view !== "world"}>
											<WorkplaceWorld active={view === "world"} />
										</div>
									)}
								</WorkplacePersonActions>
							</FileReferenceNavigation.Provider>
						</WorkspaceContext.Provider>
					</div>
				)}
			</div>
			{leaving && world && (
				<DepartureDialog
					key={leaving.id}
					selection={leaving}
					heading={`Leave ${leaving.name}: let its ${leaving.people.length} ${leaving.people.length === 1 ? "person" : "people"} go`}
					handoffs="none"
					open={leavingOpen}
					connected={world.connected}
					onUnsettled={setLeavingUnsettled}
					onHide={() => setLeavingOpen(false)}
					onClose={() => {
						setLeaving(undefined);
						setLeavingOpen(false);
					}}
				/>
			)}
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
	const workspaceRoot = useContext(WorkspaceContext).current?.id;
	const rootName =
		world.characters.find((person) => person.id === workspaceRoot)?.name ??
		world.dormant?.find((person) => person.id === workspaceRoot)?.name;
	const openMenu = useWorkplaceMenu();
	const [renameChannel, setRenameChannel] = useState<{ id: string; name: string; trigger: HTMLElement }>();
	const channelMenu = (
		event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
		channel: Pick<WorkplaceThread, "id">,
	) => {
		const head = /^(?:organization|team):(.+)$/.exec(channel.id)?.[1];
		const trigger = event.currentTarget;
		const name = head
			? (world.characters.find((person) => person.id === head)?.name ??
				world.dormant?.find((person) => person.id === head)?.name ??
				head)
			: "";
		openMenu(event, [
			...(head ? [{ label: "Rename", onSelect: () => setRenameChannel({ id: head, name, trigger }) }] : []),
			...sectionMenu(`channel:${channel.id}`),
		]);
	};
	const closeChannelRename = () => {
		setRenameChannel(undefined);
		requestAnimationFrame(() => {
			if (renameChannel?.trigger.isConnected) renameChannel.trigger.focus();
		});
	};
	const sectionStore = useSections();
	const [naming, setNaming] = useState<(name: string) => void>();
	const [selection, setSelection] = useState<{
		kind: "dm" | "channel" | "desk" | "threads" | "activity" | "later" | "notes" | "canvases";
		id: string;
	}>();
	const view = selection?.kind ?? "desk";
	const [openThread, setOpenThread] = useState<OpenThread>();
	const [channelTools, setChannelTools] = useState<HTMLElement | null>(null);

	const showThread = (thread: OpenThread) => {
		setOpenThread(thread);
		setSelection({ kind: "threads", id: "threads" });
		setProfile(undefined);
	};
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
	const mutedKeys = new Set(muted.use().map((item) => item.key));
	const unreads = new Map(
		[...channelUnreads(world)].map(([id, count]) => [id, mutedKeys.has(`channel:${id}`) ? 0 : count]),
	);
	const unseen = (agent: Character) => !!agent.facts?.unseen && !mutedKeys.has(`dm:${agent.id}`);
	const desk = world.desk;
	const selectedChannel = channels.find((thread) => selection?.kind === "channel" && thread.id === selection.id);
	const needsYou = activityItems(world, {
		dm: (id) => openDM(id),
		thread: showThread,
		mail: (id) =>
			showThread({ id, title: world.operatorMail?.find((thread) => thread.id === id)?.subject ?? "Conversation" }),
	});
	const unseenActivity = useActivitySeen(needsYou, active && view === "activity");
	const lasting = orgPeople(world);
	const parents = new Map(lasting.map((person) => [person.character.id, person.parent]));
	const heads = lasting.filter(
		(person) =>
			(!person.parent || !parents.has(person.parent)) && descendants(person.character.id, parents).length >= 4,
	);
	const headIds = new Set(heads.map((person) => person.character.id));
	const placed = (key: string) =>
		sectionStore.sections.list.some((item) => item.id === sectionStore.sections.placement[key]);
	const direct = world.characters.filter((agent) => !headIds.has(agent.id) && !placed(`dm:${agent.id}`));
	const sectionMenu = (key: string) => [
		...sectionStore.menuItems(key, (create) => setNaming(() => create)),
		mutedKeys.has(key)
			? { label: "Unmute", onSelect: () => muted.remove(key) }
			: { label: "Mute", onSelect: () => muted.add({ key }) },
	];
	const sleeping = world.dormant?.filter((agent) => !agent.retiredAt && !headIds.has(agent.id)) ?? [];
	const sleeper = world.dormant?.find((agent) => selection?.kind === "dm" && agent.id === selection.id);
	const person =
		world.characters.find((agent) => selection?.kind === "dm" && agent.id === selection.id) ??
		(sleeper ? sleeperCharacter(sleeper) : undefined);
	const dmId = person?.id;
	const dmName = person?.name;
	const dmAwake = !sleeper;
	const dmMessage = useMemo(
		() => (dmId ? dmMessageFor(dmId, `DM with ${dmName}`, dmAwake) : undefined),
		[dmId, dmName, dmAwake],
	);
	const latest = useRef(world);
	latest.current = world;

	const markAllRead = useCallback(async () => {
		const now = latest.current;
		await Promise.all([
			...now.characters.filter((agent) => agent.facts?.unseen).map((agent) => api.markSeen(agent.id)),
			...[...channelUnreads(now)]
				.filter(([, count]) => count > 0)
				.map(([thread, count]) =>
					api.communications.readThread({ thread, view: "catch_up", limit: count, attempt: crypto.randomUUID() }),
				),
		]);
	}, []);

	useEffect(() => {
		if (!active) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
				event.preventDefault();
				void markAllRead();
				return;
			}
			if (!event.altKey || event.metaKey || event.ctrlKey) return;
			if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
			const rows = [
				...(layout.current?.querySelectorAll<HTMLButtonElement>(
					".wp-chat-sidebar :is(.wp-nav-item, .wp-channel, .wp-group, .wp-dm-link)",
				) ?? []),
			].filter((row) => row.getClientRects().length > 0);
			const current = rows.findIndex((row) => row.getAttribute("aria-pressed") === "true");
			const step = event.key === "ArrowDown" ? 1 : -1;
			for (let index = current + step; index >= 0 && index < rows.length; index += step) {
				if (event.shiftKey && !rows[index]!.closest("[data-unread='true']")) continue;
				event.preventDefault();
				rows[index]!.click();
				return;
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, markAllRead]);
	const go = (target: SwitchTarget) => {
		if (target.kind === "view") setSelection({ kind: target.view, id: target.view });
		else if (target.kind === "dm") {
			openDM(target.id);
			if (target.entry) revealEntry(target.entry);
		} else if (target.kind === "channel")
			setSelection(
				target.id === world.desk?.thread ? { kind: "desk", id: "desk" } : { kind: "channel", id: target.id },
			);
		else showThread({ id: target.id, title: target.title });
	};
	const matches = (name: string) => name.toLowerCase().includes(filter.toLowerCase());
	const channelRow = (thread: (typeof channels)[number]) => (
		<button
			type="button"
			className="wp-channel"
			aria-haspopup="menu"
			onContextMenu={(event) => channelMenu(event, thread)}
			onKeyDown={(event) => channelMenu(event, thread)}
			data-unread={(unreads.get(thread.id) ?? 0) > 0}
			data-muted={mutedKeys.has(`channel:${thread.id}`)}
			aria-label={`# ${channelName(thread.id, thread.subject, world)}`}
			aria-description={`${unreads.get(thread.id) ?? 0} unread messages`}
			key={thread.id}
			aria-pressed={selectedChannel?.id === thread.id}
			onClick={() => setSelection({ kind: "channel", id: thread.id })}
		>
			<span>#</span>
			<span>{channelName(thread.id, thread.subject, world)}</span>
			{selectedChannel?.id !== thread.id && drafts.get(thread.id) && <DraftMark />}
			{(unreads.get(thread.id) ?? 0) > 0 && (
				<b className="wp-unread-count" aria-hidden="true">
					{unreads.get(thread.id)}
				</b>
			)}
		</button>
	);
	const personRow = (agent: Character, home = false) => (
		<fieldset
			className="wp-dm"
			key={agent.id}
			tabIndex={-1}
			aria-label={agent.name}
			data-selected={person?.id === agent.id}
			data-unread={unseen(agent)}
			data-muted={mutedKeys.has(`dm:${agent.id}`)}
			onContextMenu={(event) => personMenu(event, agent.id, sectionMenu(`dm:${agent.id}`))}
		>
			<PersonAvatar id={agent.id} name={agent.name} className="wp-person-icon" presence={presenceOf(agent, home)} />
			<button
				type="button"
				className="wp-dm-link"
				aria-haspopup="menu"
				onKeyDown={(event) => personMenu(event, agent.id, sectionMenu(`dm:${agent.id}`))}
				aria-description={unseen(agent) ? "Unread update" : undefined}
				aria-pressed={person?.id === agent.id}
				onClick={() => openDM(agent.id)}
			>
				<span className="wp-dm-summary">
					<span className="wp-dm-name">
						<strong>{agent.name}</strong>
						{agent.facts?.temporary && <KindBadge kind="temp" />}
						{!home && agent.facts?.status === "working" && (
							<span className="wp-dm-working" role="img" aria-label="Working" title="Working">
								<Icon name="activity" />
							</span>
						)}
					</span>
					<small>{home ? "Away" : (agent.facts?.task?.title ?? agent.facts?.title ?? activity(agent))}</small>
				</span>
				{person?.id !== agent.id && conversationPanel.draft(agent.id) && <DraftMark />}
				{unseen(agent) && <span className="wp-unread-dot" aria-hidden="true" />}
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
			<ForwardProvider world={world} go={go}>
				<div className="wp-chat-layout" ref={layout} style={sidebar.style}>
					<aside className="wp-chat-sidebar" ref={sidebar.ref}>
						<div className="wp-sidebar-heading">
							{rootName && workspaceRoot ? (
								<OrgNameEditor key={workspaceRoot} id={workspaceRoot} name={rootName} heading="h1" />
							) : (
								<OrgNameEditor id="workspace" name="Your organization" defaultName="Your organization" heading="h1" />
							)}
							<p>
								{`${world.characters.filter((person) => person.facts?.status === "working").length} working \u00b7 ${world.characters.length} awake`}
							</p>
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
						<ChatNav
							world={world}
							view={view}
							select={(kind) => setSelection({ kind, id: kind })}
							deskUnread={desk ? (unreads.get(desk.thread) ?? 0) : 0}
							needsYou={view === "activity" ? 0 : unseenActivity.size}
						/>
						{naming && (
							<SectionNamer
								onDone={(name) => {
									if (name) naming(name);
									setNaming(undefined);
								}}
							/>
						)}
						<CustomSections
							store={sectionStore}
							render={(key) => {
								if (key.startsWith("channel:")) {
									const thread = channels.find((item) => item.id === key.slice("channel:".length));
									return thread && matches(channelName(thread.id, thread.subject, world)) ? channelRow(thread) : null;
								}
								const id = key.slice("dm:".length);
								const awake = world.characters.find((agent) => agent.id === id);
								const away = world.dormant?.find((agent) => agent.id === id && !agent.retiredAt);
								const agent = awake ?? (away ? sleeperCharacter(away) : undefined);
								return agent && matches(agent.name) ? personRow(agent, !awake) : null;
							}}
						/>
						<SidebarSection
							id="channels"
							title="Channels"
							count={channels.filter((thread) => thread.id !== desk?.thread && !thread.id.startsWith("team:")).length}
							tools={
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
							}
						>
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
								.filter(
									(thread) =>
										thread.id !== desk?.thread &&
										!thread.id.startsWith("team:") &&
										!placed(`channel:${thread.id}`) &&
										matches(channelName(thread.id, thread.subject, world)),
								)
								.map(channelRow)}
							{!channels.length && (
								<p className="wp-sidebar-note">Discover shared context or create a topic channel.</p>
							)}
						</SidebarSection>
						<PinnedThreadList
							world={world}
							selected={view === "threads" ? openThread?.id : undefined}
							open={showThread}
						/>
						<GroupList
							world={world}
							groups={channels.filter((thread) => thread.id.startsWith("team:") && !placed(`channel:${thread.id}`))}
							filter={filter}
							unreads={unreads}
							selected={selectedChannel?.id}
							open={(id) => setSelection({ kind: "channel", id })}
							menu={channelMenu}
							draftMark={(id) => (drafts.get(id) ? <DraftMark /> : null)}
						/>
						{heads.length > 0 && (
							<SidebarSection id="vips" title="VIPs" count={heads.length}>
								{heads
									.filter((head) => matches(head.character.name) && !placed(`dm:${head.character.id}`))
									.map((head) => personRow(head.character, head.home))}
							</SidebarSection>
						)}
						<SidebarSection id="direct" title="Direct messages" count={direct.length}>
							{direct.filter((agent) => matches(agent.name)).map((agent) => personRow(agent))}
						</SidebarSection>
						{sleeping.length > 0 && (
							<details className="wp-sleepers">
								<summary>Away ({sleeping.length})</summary>
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
											{agent.temporary && <KindBadge kind="temp" />}
											<small>Away</small>
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
										className="wp-header-avatar"
										presence={presenceOf(person, !!sleeper)}
									/>
									<div className="wp-header-person">
										<h1>
											<PersonName id={person.id} name={person.name} />
										</h1>
										<p>
											<span className={`wp-dot is-${presenceOf(person, !!sleeper)}`} />
											{sleeper?.retiredAt
												? "Former member \u00b7 history only"
												: sleeper
													? "Away"
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
												<TranscriptMessage.Provider value={dmMessage}>
													<MentionPeople.Provider value={world}>
														<EmbeddedConversation character={person} store={store} showTools={showTools} />
													</MentionPeople.Provider>
												</TranscriptMessage.Provider>
											</FileReferenceCwd.Provider>
										)}
									</TranscriptAuthor.Provider>
								</div>
							</>
						) : selectedChannel ? (
							<>
								<ChannelHeader
									world={world}
									channel={selectedChannel}
									label={channelName(selectedChannel.id, selectedChannel.subject, world)}
									menu={channelMenu}
									tools={setChannelTools}
								/>
								{active && (
									<ThreadPane
										key={selectedChannel.id}
										id={selectedChannel.id}
										channel={selectedChannel}
										channelLabel={channelName(selectedChannel.id, selectedChannel.subject, world)}
										world={world}
										drafts={drafts}
										embedded
										toolbarHost={channelTools}
										openThread={showThread}
									/>
								)}
							</>
						) : (
							active && (
								<OrganizationView
									view={view}
									world={world}
									drafts={drafts}
									needsYou={needsYou}
									unseen={unseenActivity}
									thread={openThread}
									openThread={showThread}
									closeThread={() => setOpenThread(undefined)}
									openDM={openDM}
									markAllRead={() => void markAllRead()}
									go={go}
								/>
							)
						)}
					</main>
					<QuickSwitcher world={world} active={active} go={go} />
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
			</ForwardProvider>
		</ChatPeople.Provider>
	);
}

createRoot(document.getElementById("overlay")!).render(
	<WorkplaceMenuProvider>
		<Workplace />
	</WorkplaceMenuProvider>,
);

import { Fragment, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
	Character,
	Desk,
	DormantAgent,
	Questionnaire,
	WorkplaceTask,
	WorkplaceTaskHistory,
	WorldSnapshot,
} from "../src/world.js";
import { QuestionForm } from "./overlay/conversation/question-form.js";
import { plainLine } from "./overlay/conversation/quote.js";
import { useWorkplaceMenu } from "./workplace-context-menu.js";
import { Select } from "./workplace-fields.js";
import { Icon } from "./workplace-icon.js";
import { later, pinnedThreads, useLater } from "./workplace-later.js";
import { deliver } from "./workplace-message-actions.js";
import { NotesView } from "./workplace-notes.js";
import { OutsideActivity } from "./workplace-outside.js";
import { PersonAvatar, PersonName, presenceOf, sessionStatus } from "./workplace-people.js";
import { destinations, Picker, type SwitchTarget } from "./workplace-switcher.js";
import { ThreadPane } from "./workplace-thread.js";
import { chooseWorkspace, WorkspaceContext, workspaceOf } from "./workplace-workspaces.js";
import "./workplace-desk.css";

const api = window.agentWorkplace;

const FLIGHT_OPEN = "workplace-desk-flight-open";

const CanvasesView = lazy(() => import("./workplace-canvases.js").then((module) => ({ default: module.CanvasesView })));

export type OpenThread = { id: string; title: string };

const workingOn = (world: WorldSnapshot, task: WorkplaceTask) =>
	task.assignees.some(
		(assignee) =>
			assignee.focused && world.characters.find((person) => person.id === assignee.person)?.facts?.status === "working",
	);

const ago = (at: number | null | undefined) => {
	if (!at) return "";
	const minutes = Math.round((Date.now() - at) / 60_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

function personIn(world: WorldSnapshot, id: string): { person: Character | DormantAgent; away: boolean } | undefined {
	const awake = world.characters.find((person) => person.id === id);
	if (awake) return { person: awake, away: false };
	const dormant = world.dormant?.find((person) => person.id === id && !person.retiredAt);
	return dormant ? { person: dormant, away: true } : undefined;
}

function deskCandidates(world: WorldSnapshot): { id: string; name: string; away: boolean }[] {
	const awake = world.characters
		.filter((person) => person.facts?.title === "Coordinator" && !person.facts.temporary)
		.map((person) => ({ id: person.id, name: person.name, away: false }));
	const asleep = (world.dormant ?? [])
		.filter((person) => person.title === "Coordinator" && !person.retiredAt && !person.temporary)
		.map((person) => ({ id: person.id, name: person.name, away: true }));
	return [...awake, ...asleep];
}

function DeskSetup({ world, focus = false }: { world: WorldSnapshot; focus?: boolean }) {
	const root = useContext(WorkspaceContext).current?.id;
	const candidates = deskCandidates(world);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const actions = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (focus) actions.current?.querySelector<HTMLButtonElement>("button")?.focus();
	}, [focus]);
	const sleepingHead = root ? world.dormant?.find((person) => person.id === root) : undefined;
	const open = async (person: string) => {
		setBusy(true);
		setError("");
		try {
			const created = await api.communications.createChannel({
				attempt: crypto.randomUUID(),
				scopeHead: person,
				name: "desk",
				purpose: "The operator's desk: he tells the organization what he needs here, and the coordinator routes it.",
				invite: [person],
			});
			if (created.outcome !== "applied" || !created.effect) {
				setError(created.reason ?? `Creating the desk channel was ${created.outcome}.`);
				return;
			}
			const stored = await api.setDesk?.({ thread: created.effect.thread.id, person });
			if (stored && !stored.ok) setError(stored.reason ?? "The desk was not stored.");
		} catch (failure) {
			setError(String(failure));
		} finally {
			setBusy(false);
		}
	};
	const hire = async () => {
		setBusy(true);
		setError("");
		try {
			const head = world.characters.find((person) => person.id === root);
			const cwd =
				head?.facts?.cwd ??
				world.dormant?.find((person) => person.id === root)?.cwd ??
				world.characters[0]?.facts?.cwd ??
				world.dormant?.[0]?.cwd;
			if (!cwd) {
				setError("Start any Pi session first, so the coordinator has a directory to work in.");
				return;
			}
			const receipt = await api.recruit({
				name: "",
				cwd,
				role: "coordinator",
				...(head ? { reportsTo: head.id } : {}),
			});
			if (!receipt.ok || !receipt.sessionId) {
				setError(receipt.ok ? "The coordinator could not start." : receipt.reason);
				return;
			}
			await open(receipt.sessionId);
		} catch (failure) {
			setError(String(failure));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="wp-desk-setup">
			<span className="wp-empty-icon">
				<Icon name="desk" />
			</span>
			<h1>Open the desk</h1>
			<p>
				Talk to the whole organization in one place. A coordinator listens at the desk, turns what you write into owned
				work, and tells you when something needs you.
			</p>
			{candidates.length ? (
				<div className="wp-desk-candidates" ref={actions}>
					{candidates.map((candidate) => (
						<button
							key={candidate.id}
							type="button"
							className="wp-primary"
							disabled={busy}
							onClick={() => void open(candidate.id)}
						>
							Open the desk with {candidate.name}
							{candidate.away ? " (away; wakes on mail)" : ""}
						</button>
					))}
				</div>
			) : (
				<div className="wp-desk-candidates" ref={actions}>
					<button type="button" className="wp-primary" disabled={busy || !!sleepingHead} onClick={() => void hire()}>
						Hire a coordinator and open the desk
					</button>
					{sleepingHead && (
						<p>
							{sleepingHead.name} is away. Call them in first: a coordinator hired here reports to them, and only an
							awake manager can hire.
						</p>
					)}
				</div>
			)}
			{error && <p className="wp-error">{error}</p>}
		</div>
	);
}

function InFlight({
	world,
	selected,
	openThread,
}: {
	world: WorldSnapshot;
	selected?: string;
	openThread: (thread: OpenThread) => void;
}) {
	const [open, setOpen] = useState(() => localStorage.getItem(FLIGHT_OPEN) === "true");
	const tasks = (world.workplace?.tasks ?? []).filter((task) => task.thread && task.assignees.length);
	if (!tasks.length) return null;
	const people = [...new Set(tasks.flatMap((task) => task.assignees.map((assignee) => assignee.person)))];
	const working = people.filter(
		(id) => world.characters.find((person) => person.id === id)?.facts?.status === "working",
	).length;
	return (
		<section className="wp-desk-flight" aria-label="Work in flight" data-open={open}>
			<button
				type="button"
				className="wp-desk-flight-summary"
				aria-expanded={open}
				onClick={() => {
					localStorage.setItem(FLIGHT_OPEN, String(!open));
					setOpen(!open);
				}}
			>
				<Icon name={open ? "chevron-down" : "chevron-right"} />
				<strong>{tasks.length} in flight</strong>
				<span>{`${people.length} ${people.length === 1 ? "person" : "people"} \u00b7 ${working} working now`}</span>
				<span className="wp-task-chip-avatars" aria-hidden="true">
					{people.map((id) => {
						const found = personIn(world, id);
						return (
							<PersonAvatar
								key={id}
								id={id}
								name={found?.person.name ?? "?"}
								interactive={false}
								presence={presenceOf(
									found && !found.away ? (found.person as Character) : undefined,
									!found || found.away,
								)}
							/>
						);
					})}
				</span>
			</button>
			<div className="wp-desk-flight-list" hidden={!open}>
				{tasks.map((task) => (
					<TaskChip
						key={task.id}
						world={world}
						task={task}
						selected={selected === task.thread}
						onOpen={() => openThread({ id: task.thread!, title: task.title })}
					/>
				))}
			</div>
		</section>
	);
}

function TaskChip({
	world,
	task,
	selected,
	onOpen,
}: {
	world: WorldSnapshot;
	task: WorkplaceTask;
	selected: boolean;
	onOpen: () => void;
}) {
	const working = workingOn(world, task);
	return (
		<button type="button" className="wp-task-chip" aria-pressed={selected} data-working={working} onClick={onOpen}>
			<span className="wp-task-chip-avatars" aria-hidden="true">
				{task.assignees.slice(0, 3).map((assignee) => {
					const found = personIn(world, assignee.person);
					return (
						<PersonAvatar
							key={assignee.person}
							id={assignee.person}
							name={found?.person.name ?? "?"}
							interactive={false}
							presence={presenceOf(
								found && !found.away ? (found.person as Character) : undefined,
								!found || found.away,
							)}
						/>
					);
				})}
			</span>
			<span className="wp-task-chip-title">{task.title}</span>
			{task.status && <small>{task.status}</small>}
		</button>
	);
}

let arrivingAtDesk = false;

export function DeskView({
	world,
	desk,
	drafts,
	selectedThread,
	openThread,
	openDM,
}: {
	world: WorldSnapshot;
	desk: Desk | null | undefined;
	drafts: Map<string, string>;
	selectedThread?: string;
	openThread: (thread: OpenThread) => void;
	openDM: (id: string) => void;
}) {
	const [tools, setTools] = useState<HTMLElement | null>(null);
	const [movingTo, setMovingTo] = useState<string>();
	const place = useContext(WorkspaceContext);
	const home = desk ? workspaceOf(place.all, desk.person) : undefined;
	const elsewhere = home && place.current && home.id !== place.current.id ? home : undefined;
	const heading = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (!arrivingAtDesk || !heading.current) return;
		arrivingAtDesk = false;
		heading.current.focus();
	});
	if (!desk || (elsewhere && movingTo === place.current?.id))
		return <DeskSetup world={world} focus={!!desk && movingTo === place.current?.id} />;
	if (elsewhere)
		return (
			<div className="wp-desk-setup">
				<span className="wp-empty-icon">
					<Icon name="desk" />
				</span>
				<h1>The desk is run from {elsewhere.name}</h1>
				<p>There is one desk. Its coordinator works in another workspace; open it there, or run it from here.</p>
				<div className="wp-desk-candidates">
					<button
						type="button"
						className="wp-primary"
						onClick={() => {
							arrivingAtDesk = true;
							chooseWorkspace(elsewhere.id);
						}}
					>
						Go there
					</button>
					<button type="button" className="wp-desk-secondary" onClick={() => setMovingTo(place.current?.id)}>
						Run the desk from here
					</button>
				</div>
			</div>
		);
	const listener = personIn(world, desk.person);
	const channel = world.workplace?.threads.find((thread) => thread.id === desk.thread) ?? { lastSeq: 0 };
	const awake = listener && !listener.away ? (listener.person as Character) : undefined;
	return (
		<>
			<header className="wp-conversation-header wp-desk-header">
				<span className="wp-desk-badge" aria-hidden="true">
					<Icon name="desk" />
				</span>
				<div className="wp-header-person">
					<h1 ref={heading} tabIndex={-1}>
						Desk
					</h1>
					<p>
						{listener ? (
							<>
								<span className={`wp-dot is-${presenceOf(awake, !awake)}`} />
								<PersonName id={desk.person} name={listener.person.name} /> listens here
								{awake ? ` \u00b7 ${sessionStatus(awake)}` : " \u00b7 Away; wakes when you write"}
							</>
						) : (
							"The desk's coordinator is no longer in the organization; open the desk again with another."
						)}
					</p>
				</div>
				<div className="wp-header-tools" ref={setTools} />
				<div className="wp-desk-listener">
					<span>Listening</span>
					<Select
						label="Who listens at the desk"
						value={desk.person}
						options={[
							...(deskCandidates(world).some((candidate) => candidate.id === desk.person)
								? []
								: [{ value: desk.person, label: listener?.person.name ?? "Former coordinator" }]),
							...deskCandidates(world).map((candidate) => ({
								value: candidate.id,
								label: candidate.name,
								...(candidate.away ? { detail: "Away" } : {}),
							})),
						]}
						onChange={(person) => void api.setDesk?.({ thread: desk.thread, person })}
					/>
				</div>
				{listener && (
					<button type="button" className="wp-desk-dm" onClick={() => openDM(desk.person)}>
						Open session
					</button>
				)}
			</header>
			<InFlight world={world} selected={selectedThread} openThread={openThread} />
			<ThreadPane
				key={desk.thread}
				id={desk.thread}
				channel={channel}
				channelLabel="desk"
				world={world}
				drafts={drafts}
				listener={desk.person}
				embedded
				toolbarHost={tools}
				openThread={openThread}
			/>
		</>
	);
}

type ThreadFilter = "all" | "live" | "waiting" | "closed";

function preview(world: WorldSnapshot, from: string | null, text: string): string {
	const flat = text.replace(/\s+/g, " ");
	if (!from) return flat;
	const name = personIn(world, from)?.person.name ?? (from === "harness" ? "Pi" : from === "operator" ? "You" : from);
	return flat.startsWith(name) ? flat : `${name}: ${flat}`;
}

export function ThreadsView({
	world,
	thread,
	openThread,
	closeThread,
	drafts,
}: {
	world: WorldSnapshot;

	thread?: OpenThread;
	openThread: (thread: OpenThread) => void;
	closeThread: () => void;
	drafts: Map<string, string>;
}) {
	const selectedThread = thread?.id;
	const [filter, setFilter] = useState("");
	const [scope, setScope] = useState<ThreadFilter>("live");
	const [bodyMatches, setBodyMatches] = useState<Set<string>>();
	const rows = useMemo(() => {
		const activity = world.workplace?.taskActivity ?? {};
		const live = new Map((world.workplace?.tasks ?? []).map((task) => [task.thread, task]));
		const temporary = (id: string) =>
			world.characters.find((person) => person.id === id)?.facts?.temporary ??
			world.dormant?.find((person) => person.id === id)?.temporary;

		const machinery = (task: WorkplaceTaskHistory) =>
			task.participants.length > 0 &&
			task.participants.every((participant) => participant.outcome === "discarded" || temporary(participant.person));
		const history = (world.workplace?.workHistory ?? [])
			.filter((task) => !machinery(task))
			.map((task) => ({
				thread: task.thread,
				title: task.title,
				status: task.status,
				live: live.has(task.thread),
				people: [...new Set(task.participants.map((participant) => participant.person))],
				updatedAt: task.updatedAt ?? task.closedAt ?? task.openedAt ?? 0,
				closed: task.closedAt !== null,
			}));
		const known = new Set(history.map((row) => row.thread));
		const extra = (world.workplace?.tasks ?? [])
			.filter((task) => task.thread && !known.has(task.thread))
			.map((task) => ({
				thread: task.thread!,
				title: task.title,
				status: task.status,
				live: true,
				people: task.assignees.map((assignee) => assignee.person),
				updatedAt: 0,
				closed: false,
			}));
		return [...extra, ...history]
			.map((row) => {
				const last = activity[row.thread];

				const task = live.get(row.thread);
				const waiting = row.live && !(task && workingOn(world, task));
				return { ...row, last, waiting, latest: Math.max(row.updatedAt, last?.lastAt ?? 0) };
			})
			.sort((a, b) => Number(b.live) - Number(a.live) || Number(a.closed) - Number(b.closed) || b.latest - a.latest);
	}, [world]);
	const needle = filter.trim().toLowerCase();
	useEffect(() => {
		if (needle.length < 3) {
			setBodyMatches(undefined);
			return;
		}
		let current = true;
		const timer = setTimeout(async () => {
			const result = await api.communications.searchMessages({ query: needle, limit: 200 }).catch(() => undefined);
			if (current && result?.ok)
				setBodyMatches(new Set(result.value.messages.map((message: { thread: string }) => message.thread)));
		}, 250);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [needle]);
	const shown = rows.filter(
		(row) =>
			(scope === "all" || (scope === "live" ? row.live : scope === "waiting" ? row.waiting : row.closed)) &&
			(!needle ||
				`${row.title} ${row.last?.preview ?? ""} ${row.people.map((id) => personIn(world, id)?.person.name ?? "").join(" ")}`
					.toLowerCase()
					.includes(needle) ||
				bodyMatches?.has(row.thread)),
	);
	const counts = {
		all: rows.length,
		live: rows.filter((row) => row.live).length,
		waiting: rows.filter((row) => row.waiting).length,
		closed: rows.filter((row) => row.closed).length,
	};
	return (
		<div className="wp-threads-split" data-open={!!thread}>
			<section className="wp-threads-view" aria-label="Threads">
				<header className="wp-conversation-header">
					<div>
						<h1>Threads</h1>
						<p>Every piece of work has a conversation. Reply in one to reach everyone working on it.</p>
					</div>
				</header>
				<div className="wp-threads-tools">
					<fieldset className="wp-segmented" aria-label="Which threads">
						{(
							[
								["all", "All"],
								["live", "In flight"],
								["waiting", "Waiting"],
								["closed", "Closed"],
							] as const
						).map(([key, label]) => (
							<button key={key} type="button" aria-pressed={scope === key} onClick={() => setScope(key)}>
								{label} <span>{counts[key]}</span>
							</button>
						))}
					</fieldset>
					<label className="wp-find wp-threads-find">
						<Icon name="search" />
						<input
							aria-label="Find a thread"
							placeholder="Search titles, people and messages"
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
						/>
					</label>
				</div>
				<ul className="wp-threads-list">
					{shown.map((row) => (
						<li key={row.thread}>
							<button
								type="button"
								aria-pressed={selectedThread === row.thread}
								data-live={row.live}
								data-unread={(row.last?.unread ?? 0) > 0}
								onClick={() => openThread({ id: row.thread, title: row.title })}
							>
								<span className="wp-threads-avatars" aria-hidden="true">
									{row.people.slice(0, 4).map((id) => {
										const found = personIn(world, id);
										return (
											<PersonAvatar
												key={id}
												id={id}
												name={found?.person.name ?? "?"}
												interactive={false}
												presence={presenceOf(
													found && !found.away ? (found.person as Character) : undefined,
													!found || found.away,
												)}
											/>
										);
									})}
								</span>
								<span className="wp-threads-title">
									<span className="wp-threads-top">
										<strong>{row.title}</strong>
										<span
											className="wp-threads-state"
											data-state={row.waiting ? "waiting" : row.live ? "live" : row.closed ? "closed" : "open"}
											title={row.waiting ? "In flight, but nobody on it is working right now" : undefined}
										>
											{row.waiting ? "Waiting" : row.live ? "Working" : row.closed ? "Closed" : "Open"}
										</span>
									</span>
									<small>
										{row.last?.preview ? preview(world, row.last.lastFrom, row.last.preview) : "No messages yet"}
									</small>
								</span>
								<span className="wp-threads-meta">
									<time>{ago(row.latest || null)}</time>
									{(row.last?.unread ?? 0) > 0 && <b className="wp-mail-unread">{row.last!.unread}</b>}
									{!row.last?.unread && (row.last?.messages ?? 0) > 0 && (
										<small>
											{row.last!.messages} {row.last!.messages === 1 ? "reply" : "replies"}
										</small>
									)}
								</span>
							</button>
						</li>
					))}
					{!shown.length && (
						<li className="wp-sidebar-note">{needle ? "No thread matches." : "No task conversations yet."}</li>
					)}
				</ul>
			</section>
			{thread && (
				<ThreadConversation key={thread.id} world={world} thread={thread} drafts={drafts} onClose={closeThread} />
			)}
		</div>
	);
}

export type ActivityItem = {
	key: string;
	kind: "asking" | "escalation" | "result" | "mail";
	who: string;
	name: string;
	text: string;
	at: number;
	open: () => void;

	answer?: { character: Character; questionnaire: Questionnaire };
};

export function activityItems(
	world: WorldSnapshot,
	go: { dm: (id: string) => void; thread: (thread: OpenThread) => void; mail: (thread: string) => void },
): ActivityItem[] {
	const items: ActivityItem[] = [];
	for (const person of world.characters) {
		if (person.facts?.temporary) continue;
		if (person.facts?.asking)
			items.push({
				key: `ask:${person.id}`,
				kind: "asking",
				who: person.id,
				name: person.name,
				text: person.facts.asking.text ?? "Is waiting for your answer.",
				at: person.facts.needsYouSince ?? 0,
				open: () => go.dm(person.id),
				...(person.facts.asking.questionnaire
					? { answer: { character: person, questionnaire: person.facts.asking.questionnaire } }
					: {}),
			});
		else if (person.facts?.unseen)
			items.push({
				key: `result:${person.id}`,
				kind: "result",
				who: person.id,
				name: person.name,
				text: person.facts.task ? `Finished a run on ${person.facts.task.title}` : "Finished a run you have not seen.",
				at: person.facts.settledAt ?? 0,
				open: () => go.dm(person.id),
			});
	}
	for (const escalation of world.workplace?.escalations ?? []) {
		const found = personIn(world, escalation.person);
		items.push({
			key: `esc:${escalation.thread}`,
			kind: "escalation",
			who: escalation.person,
			name: found?.person.name ?? escalation.person,
			text: "Escalated a decision to you.",
			at: 0,
			open: () => go.mail(escalation.thread),
		});
	}
	for (const thread of world.operatorMail ?? []) {
		if (!thread.unread || world.workplace?.escalations.some((escalation) => escalation.thread === thread.id)) continue;
		items.push({
			key: `mail:${thread.id}`,
			kind: "mail",
			who: thread.id,
			name: thread.subject,
			text: `${thread.unread} unread ${thread.unread === 1 ? "message" : "messages"}`,
			at: thread.lastAt,
			open: () => go.mail(thread.id),
		});
	}
	const order = { asking: 0, escalation: 1, result: 2, mail: 3 };
	return items.sort((a, b) => order[a.kind] - order[b.kind] || b.at - a.at);
}

const LABEL: Record<ActivityItem["kind"], string> = {
	asking: "Needs your answer",
	escalation: "Escalation",
	result: "Result to review",
	mail: "Unread mail",
};

const ACTIVITY_SEEN = "workplace-activity-seen";
const activityKey = (item: ActivityItem) => `${item.key}@${item.at}`;

export function useActivitySeen(items: ActivityItem[], viewing: boolean): Set<string> {
	const [seen, setSeen] = useState<Set<string>>(
		() => new Set(JSON.parse(localStorage.getItem(ACTIVITY_SEEN) ?? "[]") as string[]),
	);
	const keys = items.map(activityKey);
	const current = keys.join("|");
	useEffect(() => {
		if (!viewing) return;
		const next = new Set(current ? current.split("|") : []);
		localStorage.setItem(ACTIVITY_SEEN, JSON.stringify([...next]));
		return () => setSeen(next);
	}, [viewing, current]);
	return new Set(keys.filter((key) => !seen.has(key)));
}

export function ActivityView({
	world,
	items,
	unseen,
	markAllRead,
}: {
	world: WorldSnapshot;
	items: ActivityItem[];
	unseen: Set<string>;
	markAllRead: () => void;
}) {
	const [chosen, setAnswering] = useState<string>();
	const answering = chosen ?? items.find((item) => item.answer)?.key;
	return (
		<section className="wp-activity-view" aria-label="Activity">
			<header className="wp-conversation-header">
				<div>
					<h1>Activity</h1>
					<p>What needs you, most blocking first. Everything else keeps moving without you.</p>
				</div>
				<button
					type="button"
					className="wp-mark-read"
					title="Mark every conversation read (Shift + Escape)"
					onClick={markAllRead}
				>
					Mark all read <kbd>{"\u21e7Esc"}</kbd>
				</button>
			</header>
			<div className="wp-activity-scroll">
				{items.length ? (
					<ul className="wp-activity-list">
						{items.map((item) => (
							<li key={item.key} data-kind={item.kind} data-new={unseen.has(activityKey(item))}>
								<button type="button" onClick={item.open}>
									<PersonAvatar id={item.who} name={item.name} interactive={false} />
									<span className="wp-activity-body">
										<span className="wp-activity-kind">{LABEL[item.kind]}</span>
										<strong>{item.name}</strong>
										<span className="wp-activity-text">{item.text}</span>
									</span>
									{unseen.has(activityKey(item)) && <span className="wp-activity-new">New</span>}
									<time>{ago(item.at)}</time>
								</button>
								{item.answer &&
									(answering === item.key ? (
										<div className="wp-session wp-activity-answer">
											<QuestionForm
												key={item.answer.questionnaire.id}
												character={item.answer.character}
												questionnaire={item.answer.questionnaire}
											/>
										</div>
									) : (
										<button type="button" className="wp-activity-answer-open" onClick={() => setAnswering(item.key)}>
											Answer here
										</button>
									))}
							</li>
						))}
					</ul>
				) : (
					<p className="wp-activity-calm">Nothing in the organization needs you.</p>
				)}
				<OutsideActivity world={world} />
			</div>
		</section>
	);
}

export function GroupList({
	world,
	groups,
	filter,
	unreads,
	selected,
	open,
	menu,
	draftMark,
}: {
	world: WorldSnapshot;
	groups: { id: string; subject: string; participants: string[] }[];
	filter: string;
	unreads: Map<string, number>;
	selected?: string;

	draftMark: (id: string) => React.ReactNode;
	open: (id: string) => void;
	menu: (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, thread: { id: string }) => void;
}) {
	const rows = groups
		.map((group) => {
			const head = group.id.slice("team:".length);
			const members = [head, ...group.participants.filter((id) => id !== head && id !== "operator")];
			const names = members.map((id) => personIn(world, id)?.person.name ?? id);
			return { group, members, label: names.map((name) => name.split(" ")[0]).join(", "), full: names.join(", ") };
		})
		.filter((row) => row.full.toLowerCase().includes(filter.toLowerCase()));
	if (!rows.length) return null;
	return (
		<SidebarSection id="groups" title="Groups" count={rows.length}>
			{rows.map(({ group, members, label, full }) => {
				const unread = unreads.get(group.id) ?? 0;
				return (
					<button
						type="button"
						key={group.id}
						className="wp-group"
						aria-haspopup="menu"
						aria-label={`Group: ${full}`}
						title={full}
						aria-pressed={selected === group.id}
						data-unread={unread > 0}
						onContextMenu={(event) => menu(event, group)}
						onKeyDown={(event) => menu(event, group)}
						onClick={() => open(group.id)}
					>
						<span className="wp-group-avatars" aria-hidden="true">
							{members.slice(0, 2).map((id) => (
								<PersonAvatar key={id} id={id} name={personIn(world, id)?.person.name ?? id} interactive={false} />
							))}
						</span>
						<span className="wp-group-label" title={`${members.length} people`}>
							{label}
						</span>
						{selected !== group.id && draftMark(group.id)}
						{unread > 0 && (
							<b className="wp-unread-count" aria-hidden="true">
								{unread}
							</b>
						)}
					</button>
				);
			})}
		</SidebarSection>
	);
}

const SECTIONS = "workplace-sidebar-sections";

export type Sections = {
	list: { id: string; name: string }[];
	placement: Record<string, string>;
};

export function useSections() {
	const [sections, setSections] = useState<Sections>(() => {
		const stored = JSON.parse(localStorage.getItem(SECTIONS) ?? "null") as Sections | null;
		return stored ?? { list: [], placement: {} };
	});
	const save = (next: Sections) => {
		localStorage.setItem(SECTIONS, JSON.stringify(next));
		setSections(next);
	};
	return {
		sections,

		move: (key: string, section: string | null) => {
			const placement = { ...sections.placement };
			if (section) placement[key] = section;
			else delete placement[key];
			save({ ...sections, placement });
		},
		create: (name: string, key?: string) => {
			const id = crypto.randomUUID();
			save({
				list: [...sections.list, { id, name }],
				placement: key ? { ...sections.placement, [key]: id } : sections.placement,
			});
		},
		rename: (id: string, name: string) =>
			save({ ...sections, list: sections.list.map((item) => (item.id === id ? { ...item, name } : item)) }),
		remove: (id: string) =>
			save({
				list: sections.list.filter((item) => item.id !== id),
				placement: Object.fromEntries(Object.entries(sections.placement).filter(([, value]) => value !== id)),
			}),

		menuItems: (key: string, ask: (create: (name: string) => void) => void) => [
			...sections.list
				.filter((item) => sections.placement[key] !== item.id)
				.map((item) => ({
					label: `Move to ${item.name}`,
					onSelect: () => {
						const placement = { ...sections.placement, [key]: item.id };
						save({ ...sections, placement });
					},
				})),
			{
				label: "Move to a new section\u2026",
				onSelect: () =>
					ask((name) => {
						const id = crypto.randomUUID();
						const latest = JSON.parse(localStorage.getItem(SECTIONS) ?? "null") as Sections | null;
						const base = latest ?? sections;
						save({ list: [...base.list, { id, name }], placement: { ...base.placement, [key]: id } });
					}),
			},
			...(sections.placement[key]
				? [
						{
							label: "Remove from section",
							onSelect: () => {
								const placement = { ...sections.placement };
								delete placement[key];
								save({ ...sections, placement });
							},
						},
					]
				: []),
		],
	};
}

export function CustomSections({
	store,
	render,
}: {
	store: ReturnType<typeof useSections>;
	render: (key: string) => React.ReactNode;
}) {
	return store.sections.list.map((section) => {
		const keys = Object.entries(store.sections.placement)
			.filter(([, id]) => id === section.id)
			.map(([key]) => key);
		return (
			<SidebarSection
				key={section.id}
				id={`custom:${section.id}`}
				title={section.name}
				count={keys.length}
				tools={
					<span className="wp-channel-tools">
						<button
							type="button"
							aria-label={`Remove section ${section.name}`}
							title="Remove section (its conversations return to their places)"
							onClick={() => store.remove(section.id)}
						>
							{"\u00d7"}
						</button>
					</span>
				}
			>
				{keys.map((key) => (
					<Fragment key={key}>{render(key)}</Fragment>
				))}
				{!keys.length && <p className="wp-sidebar-note">Right-click a conversation to move it here.</p>}
			</SidebarSection>
		);
	});
}

export function SectionNamer({ onDone }: { onDone: (name: string | null) => void }) {
	const [name, setName] = useState("");
	return (
		<form
			className="wp-section-namer"
			onSubmit={(event) => {
				event.preventDefault();
				onDone(name.trim() || null);
			}}
		>
			<input
				// biome-ignore lint/a11y/noAutofocus: the form opens from an explicit menu choice to type a name.
				autoFocus
				aria-label="Section name"
				placeholder="Section name"
				value={name}
				onChange={(event) => setName(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") onDone(null);
				}}
			/>
			<button type="submit" disabled={!name.trim()}>
				Add
			</button>
		</form>
	);
}

const COLLAPSED = "workplace-sidebar-collapsed";

export function SidebarSection({
	id,
	title,
	count,
	tools,
	children,
}: {
	id: string;
	title: string;
	count: number;
	tools?: React.ReactNode;
	children: React.ReactNode;
}) {
	const [collapsed, setCollapsed] = useState(() =>
		(JSON.parse(localStorage.getItem(COLLAPSED) ?? "[]") as string[]).includes(id),
	);
	const toggle = () => {
		const stored = new Set(JSON.parse(localStorage.getItem(COLLAPSED) ?? "[]") as string[]);
		if (collapsed) stored.delete(id);
		else stored.add(id);
		localStorage.setItem(COLLAPSED, JSON.stringify([...stored]));
		setCollapsed(!collapsed);
	};
	return (
		<section aria-label={title} className="wp-sidebar-section" data-collapsed={collapsed}>
			<h2>
				<button type="button" className="wp-section-toggle" aria-expanded={!collapsed} onClick={toggle}>
					<Icon name={collapsed ? "chevron-right" : "chevron-down"} />
					{title}
				</button>
				{collapsed && <span>{count}</span>}
				{tools}
			</h2>
			{!collapsed && children}
		</section>
	);
}

export function ChannelHeader({
	world,
	channel,
	label,
	menu,
	tools,
}: {
	world: WorldSnapshot;

	tools?: (slot: HTMLElement | null) => void;
	channel: {
		id: string;
		subject: string;
		participants: string[];
		purpose?: string | null;
		listener?: string | null;
		charter?: string | null;
	};
	label: string;
	menu: (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, thread: { id: string }) => void;
}) {
	const group = channel.id.startsWith("team:");
	const head = group ? channel.id.slice("team:".length) : undefined;
	const members = head
		? [head, ...channel.participants.filter((id) => id !== head && id !== "operator")]
		: channel.participants.filter((id) => id !== "operator");
	const name = (id: string) => personIn(world, id)?.person.name ?? id;
	const listener = channel.listener ? name(channel.listener) : undefined;
	const kind = channel.id.startsWith("organization:") ? "Whole organization" : (channel.purpose ?? "Topic channel");
	return (
		<header className="wp-conversation-header wp-channel-header">
			{head ? (
				<span className="wp-group-avatars wp-channel-header-avatars" aria-hidden="true">
					{members.slice(0, 2).map((id) => (
						<PersonAvatar key={id} id={id} name={name(id)} interactive={false} />
					))}
				</span>
			) : null}
			<div className="wp-header-person">
				<h1
					tabIndex={-1}
					aria-haspopup={/^(organization|team):/.test(channel.id) ? "menu" : undefined}
					onContextMenu={(event) => menu(event, channel)}
					onKeyDown={(event) => menu(event, channel)}
				>
					{head ? `${name(head)}'s team` : `# ${label}`}
				</h1>
				<p title={members.map(name).join(", ")}>
					{head
						? members.map((id, index) => (
								<span key={id}>
									<PersonName id={id} name={name(id)} />
									{index < members.length - 1 && ", "}
								</span>
							))
						: `${members.length} ${members.length === 1 ? "member" : "members"} \u00b7 ${kind}`}
				</p>
			</div>
			{listener && (
				<span className="wp-channel-charter" title={channel.charter ?? undefined}>
					<Icon name="bell" />
					{listener} listens
					{channel.charter ? <small>{channel.charter}</small> : null}
				</span>
			)}
			<div className="wp-header-tools" ref={tools} />
		</header>
	);
}

export type OrganizationKind = "desk" | "threads" | "activity" | "later" | "notes" | "canvases";

export function ChatNav({
	world,
	view,
	select,
	deskUnread,
	needsYou,
}: {
	world: WorldSnapshot;
	view: string;
	select: (kind: OrganizationKind) => void;
	deskUnread: number;
	needsYou: number;
}) {
	const live = (world.workplace?.tasks ?? []).filter((task) => task.thread && task.assignees.length).length;
	const saved = useLater().length;
	const quiet = (kind: OrganizationKind) => kind === "threads" || kind === "later";
	const item = (
		kind: OrganizationKind,
		label: string,
		icon: "desk" | "threads" | "bell" | "bookmark" | "file" | "compose",
		count: number,
	) => (
		<button
			type="button"
			className="wp-nav-item"
			aria-pressed={view === kind}
			data-unread={count > 0 && !quiet(kind)}
			onClick={() => select(kind)}
		>
			<Icon name={icon} />
			<span>{label}</span>
			{count > 0 && <b className={quiet(kind) ? "wp-nav-count" : "wp-unread-count"}>{count}</b>}
		</button>
	);
	return (
		<nav className="wp-chat-nav" aria-label="Workplace views">
			{item("desk", "Desk", "desk", deskUnread)}
			{item("threads", "Threads", "threads", live)}
			{item("activity", "Activity", "bell", needsYou)}
			{item("later", "Later", "bookmark", saved)}
			{item("canvases", "Canvases", "compose", 0)}
			{item("notes", "Notes", "file", 0)}
		</nav>
	);
}

export function OrganizationView({
	view,
	world,
	drafts,
	needsYou,
	unseen,
	thread,
	openThread,
	closeThread,
	openDM,
	markAllRead,
	go,
}: {
	view: string;
	world: WorldSnapshot;
	drafts: Map<string, string>;
	needsYou: ActivityItem[];
	unseen: Set<string>;
	markAllRead: () => void;
	go: (target: SwitchTarget) => void;
	thread?: OpenThread;
	openThread: (thread: OpenThread) => void;
	closeThread: () => void;
	openDM: (id: string) => void;
}) {
	const selectedThread = thread?.id;
	if (view === "desk")
		return (
			<DeskView
				world={world}
				desk={world.desk}
				drafts={drafts}
				selectedThread={selectedThread}
				openThread={openThread}
				openDM={openDM}
			/>
		);
	if (view === "threads")
		return (
			<ThreadsView world={world} thread={thread} openThread={openThread} closeThread={closeThread} drafts={drafts} />
		);
	if (view === "activity")
		return <ActivityView world={world} items={needsYou} unseen={unseen} markAllRead={markAllRead} />;
	if (view === "later") return <LaterView go={go} />;
	if (view === "notes") return <NotesView world={world} />;
	if (view === "canvases")
		return (
			<Suspense fallback={null}>
				<CanvasesView world={world} />
			</Suspense>
		);
	return (
		<div className="wp-empty">
			<span className="wp-empty-icon">
				<Icon name="chat" />
			</span>
			<h1>A direct line to your organization</h1>
			<p>The selected person or channel is no longer available.</p>
		</div>
	);
}

function LaterView({ go }: { go: (target: SwitchTarget) => void }) {
	const saved = useLater();
	return (
		<section className="wp-activity-view wp-later-view" aria-label="Later">
			<header className="wp-conversation-header">
				<div>
					<h1>Later</h1>
					<p>Messages you saved to come back to. Save one from its menu or the bookmark on hover.</p>
				</div>
			</header>
			{saved.length ? (
				<ul className="wp-later-list">
					{saved.map((item) => (
						<li key={item.key}>
							<button type="button" className="wp-later-open" onClick={() => go(item.origin)}>
								<span className="wp-later-meta">
									<strong>{item.author}</strong>
									{item.where ? ` \u00b7 ${item.where}` : ""}
									<time dateTime={new Date(item.at).toISOString()}>{ago(item.at)}</time>
								</span>
								<span className="wp-later-text">{plainLine(item.text)}</span>
							</button>
							<button
								type="button"
								className="wp-later-done"
								title="Done: remove from Later"
								onClick={() => later.remove(item.key)}
							>
								Done
							</button>
						</li>
					))}
				</ul>
			) : (
				<div className="wp-empty">
					<span className="wp-empty-icon">
						<Icon name="bookmark" />
					</span>
					<h1>Nothing saved</h1>
					<p>Save a message for later from its hover bar, and it waits here until you mark it done.</p>
				</div>
			)}
		</section>
	);
}

function ThreadConversation({
	world,
	thread,
	drafts,
	onClose,
}: {
	world: WorldSnapshot;
	thread: OpenThread;
	drafts: Map<string, string>;
	onClose: () => void;
}) {
	const live = world.workplace?.tasks.find((item) => item.thread === thread.id);
	const past = world.workplace?.workHistory?.find((item) => item.thread === thread.id);
	const people = live
		? live.assignees.map((assignee) => assignee.person)
		: [...new Set((past?.participants ?? []).map((participant) => participant.person))];
	const state = live ? (workingOn(world, live) ? "live" : "waiting") : past?.closedAt ? "closed" : "open";
	const [tools, setTools] = useState<HTMLElement | null>(null);
	const pins = pinnedThreads.use();
	const pinned = pins.some((item) => item.key === thread.id);
	const togglePin = () =>
		pinned ? pinnedThreads.remove(thread.id) : pinnedThreads.add({ key: thread.id, title: thread.title });
	const [note, setNote] = useState<{ ok: boolean; text: string }>();
	const report = (ok: boolean, text: string) => {
		setNote({ ok, text });
		if (ok) setTimeout(() => setNote(undefined), 4000);
	};
	return (
		<section className="wp-thread-conversation" aria-label={`Thread: ${thread.title}`}>
			<header className="wp-conversation-header wp-thread-conversation-header">
				<button type="button" className="wp-thread-back" aria-label="Back to all threads" onClick={onClose}>
					<Icon name="chevron-right" />
				</button>
				<div className="wp-header-person">
					<h1 title={thread.title}>{thread.title}</h1>
					<p>
						<span className="wp-threads-state" data-state={state}>
							{state === "live" ? "Working" : state === "waiting" ? "Waiting" : state === "closed" ? "Closed" : "Open"}
						</span>
						{people.map((id, index) => (
							<span key={id}>
								<PersonName id={id} name={personIn(world, id)?.person.name ?? id} />
								{index < people.length - 1 && ", "}
							</span>
						))}
						{note && (
							<span className="wp-thread-action-note" data-ok={note.ok} role="status">
								{note.text}
							</span>
						)}
					</p>
				</div>
				<div className="wp-header-tools" ref={setTools} />
				{live ? (
					<ThreadActions
						world={world}
						task={live}
						waiting={state === "waiting"}
						report={report}
						pin={{ label: pinned ? "Remove from sidebar" : "Add to sidebar", onSelect: togglePin }}
					/>
				) : (
					<button
						type="button"
						className="wp-thread-pin"
						aria-pressed={pinned}
						title={pinned ? "Remove from the sidebar" : "Keep in the sidebar, like a channel"}
						onClick={togglePin}
					>
						{pinned ? "In sidebar" : "Add to sidebar"}
					</button>
				)}
				<button
					type="button"
					className="wp-thread-close"
					aria-label="Close thread"
					title="Close thread"
					onClick={onClose}
				>
					<Icon name="close" />
				</button>
			</header>
			<ThreadPane key={thread.id} id={thread.id} world={world} drafts={drafts} embedded toolbarHost={tools} />
		</section>
	);
}

function ThreadActions({
	world,
	task,
	waiting,
	report,
	pin,
}: {
	world: WorldSnapshot;
	task: WorkplaceTask;
	waiting: boolean;
	report: (ok: boolean, text: string) => void;
	pin: { label: string; onSelect: () => void };
}) {
	const openMenu = useWorkplaceMenu();
	const [picking, setPicking] = useState(false);
	const holders = task.assignees.map((assignee) => assignee.person);
	const nameOf = (id: string) => personIn(world, id)?.person.name ?? id;
	const nudge = async () => {
		const body = `The operator is checking on "${task.title}". Continue it now, or reply in its thread with what blocks you.`;
		const failed: string[] = [];
		for (const id of holders) {
			const awake = world.characters.some((person) => person.id === id);
			const sent = await deliver(world, { kind: "dm", id }, body);
			const woke = awake || (await api.wake(id)).ok;
			if (!sent.ok || !woke) failed.push(nameOf(id));
		}
		report(
			!failed.length,
			failed.length ? `Not reached: ${failed.join(", ")}` : `Nudged ${holders.map(nameOf).join(", ")}.`,
		);
	};
	const reassign = async (to: string) => {
		setPicking(false);
		const given = await api.assignTask(to, task.id);
		if (!given.ok) return report(false, `Not given to ${nameOf(to)}: ${given.reason}`);
		for (const id of holders.filter((holder) => holder !== to)) await api.unassignTask(id, task.id);
		report(true, `Given to ${nameOf(to)}.`);
	};
	const close = async (status: "done" | "cancelled") => {
		const result = await api.closeTask(task.id, status);
		report(result.ok, result.ok ? (status === "done" ? "Closed as done." : "Cancelled.") : result.reason);
	};
	const people = destinations(world).filter((item) => item.target.kind === "dm" && !holders.includes(item.target.id));
	return (
		<div className="wp-thread-actions">
			{waiting && holders.length > 0 && (
				<button
					type="button"
					onClick={() => void nudge()}
					title="Ask whoever holds it to continue or say what blocks them"
				>
					Nudge
				</button>
			)}
			<button
				type="button"
				aria-haspopup="menu"
				onClick={(event) =>
					openMenu(event, [
						{ label: "Reassign\u2026", onSelect: () => setPicking(true) },
						...(task.ephemeral
							? [
									{ label: "Mark done", onSelect: () => void close("done") },
									{ label: "Cancel task", onSelect: () => void close("cancelled") },
								]
							: []),
						pin,
					])
				}
			>
				Task
			</button>
			{picking && (
				<Picker
					label="Reassign task"
					placeholder={`Give "${task.title}" to\u2026`}
					items={people}
					close={() => setPicking(false)}
					choose={(item) => item.target.kind === "dm" && void reassign(item.target.id)}
				/>
			)}
		</div>
	);
}

export function PinnedThreadList({
	world,
	selected,
	open,
}: {
	world: WorldSnapshot;
	selected?: string;
	open: (thread: OpenThread) => void;
}) {
	const pins = pinnedThreads.use();
	if (!pins.length) return null;
	const activity = world.workplace?.taskActivity ?? {};
	return (
		<SidebarSection id="pinned-threads" title="Pinned threads" count={pins.length}>
			{pins.map((pin) => {
				const unread = activity[pin.key]?.unread ?? 0;
				return (
					<button
						key={pin.key}
						type="button"
						className="wp-channel wp-pinned-thread"
						aria-pressed={selected === pin.key}
						data-unread={unread > 0}
						onClick={() => open({ id: pin.key, title: pin.title })}
					>
						<span>
							<Icon name="threads" />
						</span>
						<span>{pin.title}</span>
						{unread > 0 && (
							<b className="wp-unread-count" aria-hidden="true">
								{unread}
							</b>
						)}
					</button>
				);
			})}
		</SidebarSection>
	);
}

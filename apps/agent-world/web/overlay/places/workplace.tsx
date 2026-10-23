import { useEffect, useState, useSyncExternalStore } from "react";
import type { MailThread, WorkplaceTask, WorldSnapshot } from "../../../src/world.js";
import { say } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import { markdownHtml } from "../conversation/markdown.js";
import { ThreadMessages } from "./operator-inbox.js";
import { PlaceDialog } from "./place-dialog.js";
import { type WorkplacePanel, workplacePanels } from "./workplace-state.js";
import "./workplace.css";

export function WorkplacePanels({ world }: { world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(workplacePanels.subscribe, workplacePanels.get);
	const theme = useTheme();
	return (
		<>
			{state.carrying && (
				<aside className="aw-frame aw-surface aw-carried-goal" aria-label={say(theme, "carrying-task")}>
					<button
						type="button"
						className="aw-button"
						onClick={() =>
							workplacePanels.open({ kind: "tasks", headquarters: state.carrying!.headquarters }, state.carrying!.id)
						}
					>
						{say(theme, "carrying-task")}: {state.carrying.title}
					</button>
					<button
						type="button"
						className="aw-button"
						disabled={state.progress?.state === "sending"}
						onClick={() => workplacePanels.drop()}
					>
						Put down
					</button>
					{state.progress && <p role={state.progress.state === "failed" ? "alert" : "status"}>{state.progress.text}</p>}
				</aside>
			)}
			{state.panel && (
				<Board
					key={state.opening}
					panel={state.panel}
					initialTask={state.task}
					world={world}
					busy={state.progress?.state === "sending"}
				/>
			)}
		</>
	);
}

function Board({
	panel,
	initialTask,
	world,
	busy,
}: {
	panel: WorkplacePanel;
	initialTask?: string;
	world: WorldSnapshot | undefined;
	busy: boolean;
}) {
	const theme = useTheme();
	const [selected, setSelected] = useState(initialTask);
	const [threadId, setThreadId] = useState<string>();
	const owner = world?.headquarters.find((hq) => hq.id === panel.headquarters);
	const tasks = (world?.workplace?.tasks ?? []).filter((task) => task.headquarters === panel.headquarters);
	const task = tasks.find((item) => item.id === selected || item.bundle === selected);
	const people = [
		...(world?.characters ?? []).map((person) => ({
			id: person.id,
			name: person.name,
			reportsTo: person.facts?.reportsTo,
		})),
		...(world?.dormant ?? []).filter((person) => !person.retiredAt),
	];
	const team = new Set(
		people.filter((person) => person.id === panel.team || person.reportsTo === panel.team).map((person) => person.id),
	);
	const threads = (world?.workplace?.threads ?? []).filter(
		(thread) =>
			thread.headquarters === panel.headquarters &&
			(panel.kind === "meetings"
				? thread.kind === "meeting"
				: thread.kind === "channel" && thread.id === `team:${panel.team ?? panel.headquarters}`),
	);
	const heading = say(
		theme,
		panel.kind === "tasks" ? "task-board" : panel.kind === "team" ? "team-board" : "meeting-agenda",
	);
	const notes = tasks.filter(
		(item) =>
			item.ephemeral && (panel.kind !== "team" || !panel.team || item.assignees.some((held) => team.has(held.person))),
	);
	const name = (id: string) => people.find((person) => person.id === id)?.name ?? id;
	const list = (items: WorkplaceTask[]) =>
		items.length ? (
			<ul className="aw-workplace-list">
				{items.map((item) => (
					<li key={item.id}>
						<button type="button" className="aw-button aw-workplace-choice" onClick={() => setSelected(item.id)}>
							<strong>{item.title}</strong>
							{(item.status || item.goalMissing) && (
								<span>{[item.status, item.goalMissing && "Goal file missing"].filter(Boolean).join(" · ")}</span>
							)}
							<span>
								{item.assignees.length
									? item.assignees.map((held) => `${name(held.person)}${held.focused ? " (focused)" : ""}`).join(", ")
									: "Unassigned"}
							</span>
						</button>
					</li>
				))}
			</ul>
		) : (
			<p className="aw-empty">Nothing here yet.</p>
		);
	return (
		<PlaceDialog label={task?.title ?? heading} className="aw-workplace" onClose={() => workplacePanels.close()}>
			<header className="aw-place-head">
				<h2>{task?.title ?? heading}</h2>
				<p className="aw-place-says">{owner?.name}</p>
			</header>
			{task ? (
				<TaskGoal key={task.id} task={task} people={people} busy={busy} back={() => setSelected(undefined)} />
			) : (
				<>
					{selected && <p role="status">That goal is no longer on this board.</p>}
					{panel.kind === "tasks" && (
						<>
							<h3>Assigned work</h3>
							{list(tasks.filter((item) => !item.ephemeral && item.assignees.length > 0))}
							<h3>Backlog</h3>
							<p className="aw-place-says">
								Available goals in the working directories. Looking at them does not assign them.
							</p>
							{list(tasks.filter((item) => !item.ephemeral && item.assignees.length === 0))}
						</>
					)}
					{panel.kind !== "meetings" && (
						<>
							<h3>{say(theme, "work-notes")}</h3>
							{list(notes)}
						</>
					)}
					{panel.kind !== "tasks" && (
						<>
							{!threads.length && (
								<p className="aw-empty">{panel.kind === "meetings" ? "No meeting is open." : "No team updates yet."}</p>
							)}
							<ul className="aw-workplace-list">
								{threads.map((thread) => (
									<li key={thread.id}>
										<button
											type="button"
											className="aw-button aw-workplace-choice"
											aria-pressed={threadId === thread.id}
											onClick={() => setThreadId(thread.id)}
										>
											<strong>{thread.subject}</strong>
											<span>{thread.participants.map(name).join(", ")}</span>
										</button>
									</li>
								))}
							</ul>
							{threadId && (
								<SharedThread
									key={threadId}
									id={threadId}
									latest={threads.find((thread) => thread.id === threadId)?.lastSeq}
								/>
							)}
						</>
					)}
				</>
			)}
		</PlaceDialog>
	);
}

function TaskGoal({
	task,
	people,
	busy,
	back,
}: {
	task: WorkplaceTask;
	people: { id: string; name: string }[];
	busy: boolean;
	back: () => void;
}) {
	const theme = useTheme();
	const [body, setBody] = useState<string>();
	const [error, setError] = useState("");
	const [person, setPerson] = useState("");
	const [discussion, setDiscussion] = useState(false);
	useEffect(() => {
		let current = true;
		setBody(undefined);
		setError("");
		void window.agentWorld
			.readTask(task.id)
			.then((result) => {
				if (!current) return;
				if (result.ok) setBody(result.text);
				else setError(result.reason);
			})
			.catch((failure) => {
				if (current) setError(String(failure));
			});
		return () => {
			current = false;
		};
	}, [task.id]);
	const target = people.find((item) => item.id === person);
	return (
		<>
			<button type="button" className="aw-button" onClick={back}>
				Back to the board
			</button>
			<p className="aw-workplace-path">{task.bundle}/task.md</p>
			{body === undefined && !error && <p role="status">Reading the goal...</p>}
			{body !== undefined && (
				// biome-ignore lint/a11y/noStaticElementInteractions: anchors in the rendered Markdown take the keyboard
				<div
					className="aw-md aw-workplace-goal"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: markdownHtml escapes raw HTML and unsafe URL schemes
					dangerouslySetInnerHTML={{ __html: markdownHtml(body) }}
					onKeyDown={() => {}}
					onClick={(event) => {
						const link = (event.target as HTMLElement).closest("a");
						if (!link) return;
						event.preventDefault();
						const href = link.getAttribute("href");
						if (!href) return;
						const open = link.hasAttribute("data-file")
							? window.agentWorld.openFile(href, task.bundle)
							: window.agentWorld.openLink(href);
						void open
							.then((result) => {
								if (!result.ok) setError(result.reason);
							})
							.catch((failure) => setError(String(failure)));
					}}
				/>
			)}
			{error && <p role="alert">{error}</p>}
			<div className="aw-workplace-actions">
				<button
					type="button"
					className="aw-button"
					disabled={busy || body === undefined}
					onClick={() => workplacePanels.carry(task)}
				>
					{say(theme, "carry-task")}
				</button>
				<label>
					Give to{" "}
					<select
						aria-label="Give to"
						value={person}
						disabled={busy}
						onChange={(event) => setPerson(event.target.value)}
					>
						<option value="">Choose a person</option>
						{people.map((item) => (
							<option key={item.id} value={item.id}>
								{item.name}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					className="aw-button"
					disabled={busy || !target || body === undefined}
					onClick={() => {
						if (!target) return;
						workplacePanels.carry(task);
						void workplacePanels.give(target);
					}}
				>
					{say(theme, "give-task")}
				</button>
			</div>
			{task.thread && (
				<>
					<button type="button" className="aw-button" onClick={() => setDiscussion(!discussion)}>
						{discussion ? "Close discussion" : "Read discussion"}
					</button>
					{discussion && <SharedThread id={task.thread} />}
				</>
			)}
		</>
	);
}

function SharedThread({ id, latest }: { id: string; latest?: number }) {
	const [thread, setThread] = useState<MailThread>();
	const [error, setError] = useState("");
	const [revision, setRevision] = useState(0);
	const [pending, setPending] = useState(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new revision is the operator's request to read again
	useEffect(() => {
		let current = true;
		setPending(true);
		setError("");
		void window.agentWorld
			.readWorkplaceThread(id)
			.then((result) => {
				if (!current) return;
				if (result.ok) setThread(result.thread);
				else setError(result.reason);
			})
			.catch((failure) => {
				if (current) setError(String(failure));
			})
			.finally(() => {
				if (current) setPending(false);
			});
		return () => {
			current = false;
		};
	}, [id, revision]);
	return (
		<article className="aw-thread aw-workplace-thread" aria-label={thread?.subject ?? "Shared conversation"}>
			{thread && (
				<>
					<h3>{thread.subject}</h3>
					<p className="aw-thread-people">
						{thread.participants.map((person) => (person.id === "operator" ? "You" : person.name)).join(", ")}
					</p>
					<ThreadMessages thread={thread} />
					{thread.closed && <p>Meeting closed.</p>}
				</>
			)}
			{latest !== undefined && latest > (thread?.messages.at(-1)?.seq ?? 0) && !pending && (
				<p role="status">New posts are waiting.</p>
			)}
			<button type="button" className="aw-button" disabled={pending} onClick={() => setRevision(revision + 1)}>
				{pending ? "Reading..." : "Read latest"}
			</button>
			{error && <p role="alert">{error}</p>}
		</article>
	);
}

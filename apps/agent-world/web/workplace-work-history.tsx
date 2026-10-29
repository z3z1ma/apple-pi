import { useEffect, useId, useRef, useState } from "react";
import type { WorkplaceTaskHistory, WorldSnapshot } from "../src/world.js";
import { Markdown } from "./overlay/conversation/transcript.js";
import "./workplace-work-history.css";

function latest(task: WorkplaceTaskHistory): number {
	return Math.max(
		task.updatedAt ?? 0,
		task.closedAt ?? 0,
		task.openedAt ?? 0,
		...task.participants.flatMap((person) => [person.assignedAt, person.endedAt ?? 0]),
	);
}

function TaskContent({ task }: { task: WorkplaceTaskHistory }) {
	const [text, setText] = useState<string>();
	const [error, setError] = useState<string>();
	useEffect(() => {
		let current = true;
		void window.agentWorld
			.readTask(task.id)
			.then((result) => {
				if (!current) return;
				if (result.ok) setText(result.text);
				else setError(result.reason);
			})
			.catch((failure) => {
				if (current) setError(String(failure));
			});
		return () => {
			current = false;
		};
	}, [task.id]);
	return (
		<article aria-label={`Task: ${task.title}`} className="wp-work-history-content">
			<p className="wp-work-history-path">{task.bundle}/task.md</p>
			{text === undefined && !error && <p role="status">Reading task...</p>}
			{text !== undefined && (
				<Markdown
					text={text}
					onLink={(href, file) => {
						void (file ? window.agentWorld.openFile(href, task.bundle) : window.agentWorld.openLink(href))
							.then((result) => {
								if (!result.ok) setError(result.reason);
							})
							.catch((failure) => setError(String(failure)));
					}}
				/>
			)}
			{error && <p role="alert">{error}</p>}
		</article>
	);
}

function WorkDialog({
	tasks,
	heading,
	names,
	people,
	onClose,
}: {
	tasks: WorkplaceTaskHistory[];
	heading: string;
	names: Map<string, string>;
	people?: string[];
	onClose: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const close = useRef<HTMLButtonElement>(null);
	const title = useId();
	const [selected, setSelected] = useState<string>();
	const [query, setQuery] = useState("");
	const task = tasks.find((item) => item.id === selected);
	const matches = tasks.filter((item) =>
		`${item.title} ${item.status ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
	);
	useEffect(() => {
		const element = dialog.current!;
		const trigger = document.activeElement;
		element.showModal();
		close.current?.focus();
		return () => {
			element.close();
			if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
		};
	}, []);
	useEffect(() => {
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			onClose();
		};
		window.addEventListener("keydown", onEscape, { capture: true });
		return () => window.removeEventListener("keydown", onEscape, { capture: true });
	}, [onClose]);
	return (
		<dialog
			ref={dialog}
			className="wp-work-dialog"
			aria-labelledby={title}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<header>
				<div>
					<h2 id={title}>{heading}</h2>
					<p>
						{tasks.length} {tasks.length === 1 ? "task" : "tasks"} · select one to read its details
					</p>
				</div>
				<button type="button" ref={close} aria-label="Close work history" onClick={onClose}>
					Close
				</button>
			</header>
			<div className="wp-work-dialog-layout">
				<nav className="wp-work-dialog-list" aria-label="Tasks">
					<label className="wp-work-dialog-filter">
						Filter work
						<input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Task title or status"
						/>
					</label>
					{matches.length ? (
						matches.map((item) => (
							<button
								key={item.id}
								type="button"
								aria-label={`Read task: ${item.title}`}
								aria-pressed={item.id === selected}
								onClick={() => setSelected(item.id)}
							>
								<strong>{item.title}</strong>
								<span>
									{item.status ?? "Status not recorded"}
									{latest(item) > 0 ? ` · ${new Date(latest(item)).toLocaleDateString()}` : ""}
								</span>
								<span>Recorded organization: {names.get(item.headquarters) ?? item.headquarters}</span>
							</button>
						))
					) : (
						<p>No matching work.</p>
					)}
				</nav>
				<section className="wp-work-dialog-detail" aria-label="Task detail">
					{task ? (
						<>
							<h3>{task.title}</h3>
							<p>
								{task.status ?? "Status not recorded"} · Recorded organization:{" "}
								{names.get(task.headquarters) ?? task.headquarters}
							</p>
							<ul className="wp-work-history-participants">
								{task.participants
									.filter((person) => people === undefined || people.includes(person.person))
									.map((person, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: repeated assignment records contain only stateless text and have no public assignment ID.
										<li key={`${person.person}:${person.assignedAt}:${index}`}>
											{names.get(person.person) ?? person.person}:{" "}
											{person.outcome === "held"
												? person.focused
													? "assigned, in focus"
													: "assigned"
												: person.outcome === "finished"
													? "assignment finished"
													: person.outcome === "unknown"
														? "outcome not recorded"
														: person.outcome}
										</li>
									))}
							</ul>
							<TaskContent key={task.id} task={task} />
						</>
					) : (
						<p className="wp-work-dialog-empty">Choose a task to see its participants and details.</p>
					)}
				</section>
			</div>
		</dialog>
	);
}

export function WorkHistory({
	world,
	team,
	people,
	compact = false,
}: {
	world: WorldSnapshot;
	team?: string;
	people?: string[];
	compact?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const history = world.workplace?.workHistory;
	const tasks = (history ?? [])
		.filter((task) =>
			team !== undefined
				? task.headquarters === team
				: people !== undefined && task.participants.some((person) => people.includes(person.person)),
		)
		.sort((a, b) => latest(b) - latest(a) || a.id.localeCompare(b.id));
	const heading =
		team !== undefined
			? "Recorded team work"
			: people?.length === 1
				? "Recorded work"
				: "Work involving current people";
	const completed = tasks.filter((task) => task.status === "done").length;
	const active = tasks.filter(
		(task) => task.closedAt === null && task.status !== "done" && task.status !== "cancelled",
	).length;
	const names = new Map([
		...world.characters.map((person) => [person.id, person.name] as const),
		...(world.dormant ?? []).map((person) => [person.id, person.name] as const),
	]);
	return (
		<section className={`wp-work-history${compact ? " wp-work-history-compact" : ""}`} aria-label={heading}>
			{!compact && <h3>Work</h3>}
			{history === undefined ? (
				<p>Work history is not available in this snapshot.</p>
			) : tasks.length === 0 ? (
				<p>No recorded work yet.</p>
			) : (
				<>
					<p className="wp-work-history-counts">
						{active} open · {completed} completed
						{tasks.length - active - completed > 0 && ` · ${tasks.length - active - completed} other`}
					</p>
					<p className="wp-work-history-recent" title={tasks[0].title}>
						{tasks[0].title}
					</p>
					<button
						type="button"
						className="wp-work-history-open"
						aria-label={`View recorded work (${tasks.length})`}
						onClick={() => setOpen(true)}
					>
						View work <span aria-hidden="true">({tasks.length})</span>
					</button>
				</>
			)}
			{open && (
				<WorkDialog tasks={tasks} heading={heading} names={names} people={people} onClose={() => setOpen(false)} />
			)}
		</section>
	);
}

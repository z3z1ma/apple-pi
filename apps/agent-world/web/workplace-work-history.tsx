import { useEffect, useState } from "react";
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
	const [selected, setSelected] = useState<string>();
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
	const list = (
		<ul className="wp-work-history-list">
			{tasks.map((task) => (
				<li key={task.id}>
					<button
						type="button"
						aria-label={`Read task: ${task.title}`}
						aria-expanded={selected === task.id}
						onClick={() => setSelected(selected === task.id ? undefined : task.id)}
					>
						{task.title}
					</button>
					<div className="wp-work-history-meta">
						<span>{task.status ?? "Status not recorded"}</span>
						{latest(task) > 0 && (
							<time dateTime={new Date(latest(task)).toISOString()}>{new Date(latest(task)).toLocaleDateString()}</time>
						)}
					</div>
					{team === undefined && <p>Recorded organization: {names.get(task.headquarters) ?? task.headquarters}</p>}
					<ul className="wp-work-history-participants">
						{task.participants
							.filter((person) => people === undefined || people.includes(person.person))
							.map((person, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: repeated assignment records lack IDs; these rows contain only stateless text.
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
					{selected === task.id && <TaskContent key={task.id} task={task} />}
				</li>
			))}
		</ul>
	);
	return (
		<section className={`wp-work-history${compact ? " wp-work-history-compact" : ""}`} aria-label={heading}>
			<h3>{heading}</h3>
			<p>
				{team !== undefined
					? "Tasks recorded for this organization, including work by people who later moved."
					: people?.length === 1
						? "Tasks this person participated in, including work in other organizations."
						: "Tasks involving these current people, including work in other organizations."}
			</p>
			{history === undefined ? (
				<p>Work history is not available in this snapshot.</p>
			) : tasks.length === 0 ? (
				<p>No recorded work yet.</p>
			) : (
				<>
					<p className="wp-work-history-counts">
						{active} open · {completed} completed · {tasks.length - active - completed} other
					</p>
					{compact ? (
						<>
							<p className="wp-work-history-recent">Most recent: {tasks[0].title}</p>
							<details>
								<summary>View recorded work ({tasks.length})</summary>
								{list}
							</details>
						</>
					) : (
						list
					)}
				</>
			)}
		</section>
	);
}

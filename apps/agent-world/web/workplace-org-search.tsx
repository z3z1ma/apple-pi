import { useEffect, useId, useRef, useState } from "react";
import type { TaskRead, WorldSnapshot } from "../src/world.js";
import "./workplace-org-search.css";

import { searchOrg } from "./workplace-org-search-model.js";

export function OrgSearch({
	world,
	onPerson,
	onTeam,
}: {
	world: WorldSnapshot;
	onPerson: (id: string) => void;
	onTeam: (id: string) => void;
}) {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const root = useRef<HTMLDivElement>(null);
	const request = useRef(0);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [task, setTask] = useState<{ id: string; title: string; result?: TaskRead }>();
	const results = searchOrg(world, query);
	const visible = open && query.trim().length > 0;
	const close = () => {
		request.current++;
		input.current?.focus();
		setOpen(false);
		setTask(undefined);
	};
	useEffect(() => {
		if (!visible) return;
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !(event.target instanceof Node) || !root.current?.contains(event.target)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			request.current++;
			input.current?.focus();
			setOpen(false);
			setTask(undefined);
		};
		window.addEventListener("keydown", onEscape, { capture: true });
		return () => window.removeEventListener("keydown", onEscape, { capture: true });
	}, [visible]);
	const readTask = async (taskId: string, title: string) => {
		const current = ++request.current;
		setTask({ id: taskId, title });
		let result: TaskRead;
		try {
			result = await window.agentWorld.readTask(taskId);
		} catch (error) {
			result = { ok: false, reason: String(error) };
		}
		if (current === request.current) setTask({ id: taskId, title, result });
	};
	return (
		<div className="wp-org-search" ref={root}>
			<label htmlFor={id}>Search people, teams, and work</label>
			<input
				ref={input}
				id={id}
				type="search"
				value={query}
				placeholder="Name, role, team or task"
				aria-controls={`${id}-results`}
				onFocus={() => setOpen(true)}
				onChange={(event) => {
					request.current++;
					setQuery(event.target.value);
					setOpen(true);
					setTask(undefined);
				}}
			/>
			{visible && (
				<section id={`${id}-results`} className="wp-org-search-results" aria-label="Organization search results">
					<header>
						<p>Current snapshot metadata only; no conversation search.</p>
						<button type="button" onClick={close}>
							Close search results
						</button>
					</header>
					{!world.connected && <p role="status">Disconnected: showing the last recorded snapshot.</p>}
					<h2>People</h2>
					{!results.people.length ? (
						<p>No matching people.</p>
					) : (
						<ul>
							{results.people.map((person) => (
								<li key={person.id}>
									<button
										type="button"
										aria-label={`View person: ${person.name}`}
										onClick={() => {
											close();
											onPerson(person.id);
										}}
									>
										<strong>{person.name}</strong>
									</button>
									<p>
										{person.role}
										{person.home ? " · At home" : ""} · {person.id}
									</p>
									{person.task && <p>Current task: {person.task}</p>}
									<button
										type="button"
										aria-label={`Open team: ${person.teamName}`}
										onClick={() => {
											close();
											onTeam(person.team);
										}}
									>
										Team: {person.teamName}
									</button>
								</li>
							))}
						</ul>
					)}
					<h2>Work</h2>
					{world.workplace?.workHistory === undefined ? (
						<p>Recorded task history is not available in this snapshot.</p>
					) : !results.work.length ? (
						<p>No matching work.</p>
					) : (
						<ul>
							{results.work.map((item) => (
								<li key={item.id}>
									<strong>{item.title}</strong>
									<p>
										{item.status ?? "Status unknown"} · {item.id}
									</p>
									<p>Recorded organization: {item.organizationName}</p>
									<p>{item.project}</p>
									<button
										type="button"
										disabled={!world.connected}
										aria-label={`Read task: ${item.title}`}
										onClick={() => void readTask(item.id, item.title)}
									>
										Read task
									</button>
								</li>
							))}
						</ul>
					)}
					{task && (
						<article aria-label={`Task: ${task.title}`}>
							<h2>{task.title}</h2>
							{!task.result ? (
								<p role="status">Loading task...</p>
							) : task.result.ok ? (
								<pre>{task.result.text}</pre>
							) : (
								<p role="alert">{task.result.reason}</p>
							)}
						</article>
					)}
				</section>
			)}
		</div>
	);
}

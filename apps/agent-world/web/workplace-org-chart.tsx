import { useLayoutEffect, useRef, useState } from "react";
import type { Character, WorldSnapshot } from "../src/world.js";
import { organizationName, useWorkplaceNames } from "./workplace-names.js";
import { OrgNameEditor } from "./workplace-org-name.js";
import { PersonAvatar, sessionStatus } from "./workplace-people.js";
import { WorkHistory } from "./workplace-work-history.js";
import "./workplace-org-chart.css";

export type OrgPerson = { character: Character; parent: string | null; home: boolean };
const CARD_WIDTH = 220;
const CARD_HEIGHT = 116;

function teamLayout(head: OrgPerson | undefined, children: Map<string, OrgPerson[]>, collapsed: Set<string>) {
	const positions: { person: OrgPerson; x: number; y: number }[] = [];
	const edges: { from: string; to: string }[] = [];
	const seen = new Set<string>();
	let leaf = 0;
	let depth = 0;
	function place(person: OrgPerson, level: number): number {
		const id = person.character.id;
		seen.add(id);
		depth = Math.max(depth, level);
		const reports = collapsed.has(id) ? [] : (children.get(id) ?? []).filter((child) => !seen.has(child.character.id));
		const centers = reports.map((child) => {
			edges.push({ from: id, to: child.character.id });
			return place(child, level + 1);
		});
		const x = centers.length ? (centers[0]! + centers.at(-1)!) / 2 : leaf++ * (CARD_WIDTH + 36);
		positions.push({ person, x: x + 32, y: level * (CARD_HEIGHT + 60) + 28 });
		return x;
	}
	if (head) place(head, 0);
	return {
		positions,
		edges,
		width: Math.max(1, leaf) * (CARD_WIDTH + 36) + 28,
		height: (depth + 1) * (CARD_HEIGHT + 60),
	};
}

export function OrgChart({
	world,
	people,
	team,
	setTeam,
	selected,
	busy,
	manages,
	select,
	propose,
	addPerson,
}: {
	world: WorldSnapshot;
	people: OrgPerson[];
	team?: string;
	setTeam: (id: string | undefined) => void;
	selected?: string;
	busy: boolean;
	manages: (person: OrgPerson) => boolean;
	select: (id: string, element?: HTMLElement) => void;
	propose: (id: string, manager: string | null) => void;
	addPerson: (manager: string) => void;
}) {
	useWorkplaceNames();
	const [collapsed, setCollapsed] = useState(new Set<string>());
	const [dragged, setDragged] = useState<string>();
	const [zoom, setZoom] = useState(1);
	const [fitting, setFitting] = useState(true);
	const scroller = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLDivElement>(null);
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;
	const zoomAnchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
	const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
	const ids = new Set(people.map((person) => person.character.id));
	const roots = people.filter((person) => !person.parent || !ids.has(person.parent));
	const children = new Map<string, OrgPerson[]>();
	for (const person of people)
		if (person.parent && ids.has(person.parent)) {
			const reports = children.get(person.parent) ?? [];
			reports.push(person);
			children.set(person.parent, reports);
		}
	const head = roots.find((person) => person.character.id === team);
	const graph = teamLayout(head, children, collapsed);
	const headId = head?.character.id;
	useLayoutEffect(() => {
		const element = scroller.current;
		if (!element || !headId || !fitting) return;
		const resize = () => {
			if (!element.clientWidth || !element.clientHeight) return;
			setZoom(Math.min(1, element.clientWidth / graph.width, element.clientHeight / graph.height));
			element.scrollTo(0, 0);
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(element);
		return () => observer.disconnect();
	}, [headId, graph.width, graph.height, fitting]);
	useLayoutEffect(() => {
		const element = scroller.current;
		if (!element || !headId) return;
		const wheel = (event: WheelEvent) => {
			if (!event.ctrlKey) return;
			event.preventDefault();
			const bounds = canvas.current?.getBoundingClientRect();
			if (!bounds) return;
			zoomAnchor.current = {
				x: (event.clientX - bounds.left) / zoomRef.current,
				y: (event.clientY - bounds.top) / zoomRef.current,
				clientX: event.clientX,
				clientY: event.clientY,
			};
			setFitting(false);
			setZoom((value) => {
				const next = value * Math.exp(-event.deltaY / 100);
				return Number.isFinite(next) && next > 0 ? next : value;
			});
		};
		// Chromium sends trackpad pinch as ctrl+wheel; a passive listener cannot stop page zoom.
		element.addEventListener("wheel", wheel, { passive: false });
		return () => element.removeEventListener("wheel", wheel);
	}, [headId]);
	useLayoutEffect(() => {
		const anchor = zoomAnchor.current;
		zoomAnchor.current = null;
		const element = scroller.current;
		const bounds = canvas.current?.getBoundingClientRect();
		if (!anchor || !element || !bounds) return;
		element.scrollLeft += bounds.left + anchor.x * zoom - anchor.clientX;
		element.scrollTop += bounds.top + anchor.y * zoom - anchor.clientY;
	}, [zoom]);
	const branch = (id: string) => {
		const found = new Set([id]);
		for (const parent of found) for (const child of children.get(parent) ?? []) found.add(child.character.id);
		return found;
	};
	const openTeam = (id: string | undefined) => {
		zoomAnchor.current = null;
		setTeam(id);
		setFitting(true);
		scroller.current?.scrollTo(0, 0);
	};
	const canDrop = (person: OrgPerson) =>
		Boolean(dragged && manages(person) && !branch(dragged).has(person.character.id));
	const drop = (event: React.DragEvent, manager: string) => {
		event.preventDefault();
		const person = event.dataTransfer.getData("text/plain");
		if (person) propose(person, manager);
		setDragged(undefined);
	};
	const dragProps = (person: OrgPerson) => ({
		draggable: !busy && typeof window.agentWorld.orgMove === "function",
		onDragStart: (event: React.DragEvent) => {
			setDragged(person.character.id);
			event.dataTransfer.setData("text/plain", person.character.id);
			event.dataTransfer.effectAllowed = "move";
		},
		onDragEnd: () => setDragged(undefined),
		onDragOver: (event: React.DragEvent) => {
			if (canDrop(person)) event.preventDefault();
		},
		onDrop: (event: React.DragEvent) => drop(event, person.character.id),
	});
	const identity = (person: OrgPerson) => (
		<>
			<PersonAvatar id={person.character.id} name={person.character.name} interactive={false} />
			<span className="wp-org-identity">
				<strong>{person.character.name}</strong>
				<small>{person.character.facts?.title ?? "Pi session"}</small>
				<span className="wp-org-state">{person.home ? "At home" : sessionStatus(person.character)}</span>
			</span>
		</>
	);
	return (
		<div className={`wp-org-explorer${head ? " wp-org-focused" : ""}`}>
			{head && (
				<nav className="wp-org-team-nav" aria-label="Teams">
					<button type="button" className="wp-org-back" onClick={() => openTeam(undefined)}>
						All teams
					</button>
					<p className="wp-eyebrow">YOUR TEAMS</p>
					{roots.map((root) => (
						<button
							type="button"
							key={root.character.id}
							aria-label={`Open team: ${root.character.name}`}
							aria-current={head.character.id === root.character.id ? "page" : undefined}
							className={canDrop(root) ? "wp-org-drop-target" : ""}
							onClick={() => openTeam(root.character.id)}
							onDragOver={(event) => {
								if (canDrop(root)) event.preventDefault();
							}}
							onDrop={(event) => drop(event, root.character.id)}
						>
							<PersonAvatar id={root.character.id} name={root.character.name} interactive={false} />
							<span>
								<strong>{organizationName(root.character.id, root.character.name)}</strong>
								<small>
									{branch(root.character.id).size} {branch(root.character.id).size === 1 ? "person" : "people"}
								</small>
							</span>
						</button>
					))}
				</nav>
			)}
			<div className="wp-org-team-content">
				{head && (
					<>
						<header className="wp-org-team-heading">
							<div>
								<OrgNameEditor key={head.character.id} id={head.character.id} name={head.character.name} heading="h2" />
								<p>{branch(head.character.id).size} people · reporting lines</p>
							</div>
							<div className="wp-org-tools">
								<button type="button" onClick={() => setFitting(true)}>
									Fit
								</button>
								<button
									type="button"
									aria-label="Zoom out"
									onClick={() => {
										setFitting(false);
										setZoom((value) => value / 1.2);
									}}
								>
									−
								</button>
								<span>{Math.round(zoom * 100)}%</span>
								<button
									type="button"
									aria-label="Zoom in"
									onClick={() => {
										setFitting(false);
										setZoom((value) => value * 1.2);
									}}
								>
									+
								</button>
								{manages(head) && !head.home && (
									<button type="button" disabled={busy} onClick={() => addPerson(head.character.id)}>
										Add person
									</button>
								)}
							</div>
						</header>
						<div className="wp-org-team-work">
							<WorkHistory world={world} team={head.character.id} compact />
						</div>
					</>
				)}
				<div
					className={`wp-org-viewport${head ? " wp-org-chart-viewport" : ""}`}
					ref={scroller}
					onPointerDown={(event) => {
						if (!head || (event.target as HTMLElement).closest("button,fieldset,input,select,textarea,a,summary"))
							return;
						pan.current = {
							x: event.clientX,
							y: event.clientY,
							left: event.currentTarget.scrollLeft,
							top: event.currentTarget.scrollTop,
						};
						event.currentTarget.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => {
						if (pan.current) {
							event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX;
							event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY;
						}
					}}
					onPointerUp={() => {
						pan.current = null;
					}}
					onPointerCancel={() => {
						pan.current = null;
					}}
				>
					{!people.length ? (
						<div className="wp-empty">No people are recorded yet. Plan your first team.</div>
					) : head ? (
						<div className="wp-org-chart-size" style={{ width: graph.width * zoom, height: graph.height * zoom }}>
							<div
								ref={canvas}
								className="wp-org-chart-canvas"
								style={{ width: graph.width, height: graph.height, transform: `scale(${zoom})` }}
							>
								<svg className="wp-org-chart-links" width={graph.width} height={graph.height} aria-hidden="true">
									{graph.edges.map((edge) => {
										const from = graph.positions.find((item) => item.person.character.id === edge.from)!;
										const to = graph.positions.find((item) => item.person.character.id === edge.to)!;
										return (
											<path
												key={`${edge.from}:${edge.to}`}
												d={`M${from.x + CARD_WIDTH / 2},${from.y + CARD_HEIGHT} V${from.y + CARD_HEIGHT + 30} H${to.x + CARD_WIDTH / 2} V${to.y}`}
											/>
										);
									})}
								</svg>
								{graph.positions.map(({ person, x, y }) => {
									const id = person.character.id;
									const count = children.get(id)?.length ?? 0;
									return (
										<fieldset
											key={id}
											aria-label={`${person.character.name}'s branch`}
											className={`wp-org-tree-node${selected === id ? " wp-org-selected" : ""}${person.home ? " wp-org-home" : ""}${canDrop(person) ? " wp-org-drop-target" : ""}`}
											style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
											{...dragProps(person)}
										>
											<button
												type="button"
												className="wp-org-person"
												aria-label={`View profile: ${person.character.name}`}
												onClick={(event) => select(id, event.currentTarget)}
											>
												{identity(person)}
											</button>
											{count > 0 && (
												<button
													type="button"
													className="wp-org-tree-toggle"
													aria-label={`${collapsed.has(id) ? "Expand" : "Collapse"} reports of ${person.character.name}`}
													aria-expanded={!collapsed.has(id)}
													onClick={() =>
														setCollapsed((value) => {
															const next = new Set(value);
															if (next.has(id)) next.delete(id);
															else next.add(id);
															return next;
														})
													}
												>
													{collapsed.has(id) ? "+" : "−"} {count} {count === 1 ? "report" : "reports"}
												</button>
											)}
										</fieldset>
									);
								})}
							</div>
						</div>
					) : (
						<section className="wp-org-team-grid" aria-label="All teams">
							{roots.map((root) => {
								const members = branch(root.character.id);
								const atHome = people.filter((person) => members.has(person.character.id) && person.home).length;
								return (
									<fieldset
										key={root.character.id}
										aria-label={`${root.character.name}'s team`}
										className="wp-org-team-card"
										{...dragProps(root)}
									>
										<div className="wp-org-card-heading">
											<PersonAvatar id={root.character.id} name={root.character.name} interactive={false} />
											<div>
												<OrgNameEditor id={root.character.id} name={root.character.name} />
												<button
													type="button"
													className="wp-org-card-head"
													aria-label={`View profile: ${root.character.name}`}
													onClick={(event) => select(root.character.id, event.currentTarget)}
												>
													Head: {root.character.name}
												</button>
											</div>
										</div>
										<div className="wp-org-team-summary">
											<span>
												{members.size} {members.size === 1 ? "person" : "people"}
											</span>
											{atHome > 0 && <span>{atHome} at home</span>}
										</div>
										<WorkHistory world={world} team={root.character.id} compact />
										<div className="wp-org-team-actions">
											<button
												type="button"
												aria-label={`Open team: ${root.character.name}`}
												onClick={() => openTeam(root.character.id)}
											>
												Open team <span aria-hidden="true">→</span>
											</button>
											{manages(root) && !root.home && (
												<button
													type="button"
													aria-label={`Add person to ${root.character.name}'s team`}
													disabled={busy}
													onClick={() => addPerson(root.character.id)}
												>
													+ Add person
												</button>
											)}
										</div>
									</fieldset>
								);
							})}
						</section>
					)}
					{dragged && (
						<button
							type="button"
							className="wp-org-independent"
							onDragOver={(event) => event.preventDefault()}
							onDrop={(event) => {
								event.preventDefault();
								propose(event.dataTransfer.getData("text/plain"), null);
								setDragged(undefined);
							}}
						>
							Drop to make independent
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

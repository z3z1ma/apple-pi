import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Character, WorldSnapshot } from "../src/world.js";
import { DepartureDialog, type DepartureSelection } from "./workplace-departures.js";
import { Icon } from "./workplace-icon.js";
import { useWorkplaceNames } from "./workplace-names.js";
import { PersonAvatar, presenceOf, sessionStatus } from "./workplace-people.js";
import { PersonActionsButton, usePersonMenu } from "./workplace-person-actions.js";
import { usePaneResize } from "./workplace-resize.js";
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
	root,
	selected,
	busy,
	manages,
	select,
	propose,
	addPerson,
	openDM,
	onDepartureChange,
}: {
	world: WorldSnapshot;
	people: OrgPerson[];
	root?: string;
	selected?: string;
	busy: boolean;
	manages: (person: OrgPerson) => boolean;
	select: (id: string, element?: HTMLElement) => void;
	propose: (id: string, manager: string | null) => void;
	addPerson: (manager: string) => void;
	openDM: (id: string) => void;
	onDepartureChange: (unsettled: boolean) => void;
}) {
	useWorkplaceNames();
	const personMenu = usePersonMenu();
	const [checked, setChecked] = useState(new Set<string>());
	const [filter, setFilter] = useState("");
	const [departure, setDeparture] = useState<DepartureSelection>();
	const [departureOpen, setDepartureOpen] = useState(false);
	const chosen = people.filter((person) => checked.has(person.character.id));
	const [collapsed, setCollapsed] = useState(new Set<string>());
	const [dragged, setDragged] = useState<string>();
	const [zoom, setZoom] = useState(1);
	const [fitting, setFitting] = useState(true);
	const scroller = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLDivElement>(null);
	const directory = useRef<HTMLDivElement>(null);
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;
	const zoomAnchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
	const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
	const ids = new Set(people.map((person) => person.character.id));
	const children = new Map<string, OrgPerson[]>();
	for (const person of people)
		if (person.parent && ids.has(person.parent)) {
			const reports = children.get(person.parent) ?? [];
			reports.push(person);
			children.set(person.parent, reports);
		}
	const head =
		people.find((person) => person.character.id === root) ??
		people.find((person) => !person.parent || !ids.has(person.parent));
	const explorer = useRef<HTMLDivElement>(null);
	const split = usePaneResize({
		label: "Org people directory width",
		variable: "--wp-org-directory",
		axis: "x",
		direction: -1,
		min: 320,
		max: () => (explorer.current?.clientWidth ?? 0) - 360,
	});
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
	const parentOf = useRef(new Map<string, string | null>());
	parentOf.current = new Map(people.map((person) => [person.character.id, person.parent]));
	const [revealed, setRevealed] = useState<string>();
	useEffect(() => {
		if (!selected) return;
		const ancestors = new Set<string>();
		for (let id = parentOf.current.get(selected); id && !ancestors.has(id); id = parentOf.current.get(id))
			ancestors.add(id);
		setCollapsed((value) =>
			[...value].some((id) => ancestors.has(id)) ? new Set([...value].filter((id) => !ancestors.has(id))) : value,
		);
		setRevealed(selected);
	}, [selected]);
	useEffect(() => {
		if (!selected || revealed !== selected) return;
		const at = `[data-person="${CSS.escape(selected)}"]`;
		canvas.current?.querySelector(at)?.scrollIntoView({ block: "nearest", inline: "nearest" });
		directory.current?.querySelector(at)?.scrollIntoView({ block: "nearest" });
	}, [selected, revealed]);
	useEffect(() => {
		if (headId) setFitting(true);
	}, [headId]);
	const branch = (id: string) => {
		const found = new Set([id]);
		for (const parent of found) for (const child of children.get(parent) ?? []) found.add(child.character.id);
		return found;
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
		draggable: !busy && typeof window.agentWorkplace.orgMove === "function",
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
			<PersonAvatar
				id={person.character.id}
				name={person.character.name}
				interactive={false}
				presence={presenceOf(person.character, person.home)}
			/>
			<span className="wp-org-identity">
				<strong>{person.character.name}</strong>
				<small>{person.character.facts?.title ?? "Pi session"}</small>
				<span className="wp-org-state">{person.home ? "Away" : sessionStatus(person.character)}</span>
			</span>
		</>
	);
	const needle = filter.trim().toLowerCase();
	const listed = people.filter(
		(person) =>
			!needle ||
			person.character.name.toLowerCase().includes(needle) ||
			(person.character.facts?.title ?? "").toLowerCase().includes(needle),
	);
	const nameOf = (id: string | null) =>
		id ? people.find((person) => person.character.id === id)?.character.name : undefined;
	return (
		<div ref={explorer} style={split.style} className="wp-org-explorer wp-org-split">
			<div className="wp-org-team-content">
				{head && (
					<header className="wp-org-team-heading">
						<div>
							<h2>Reporting lines</h2>
							<p>{branch(head.character.id).size} people</p>
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
				)}
				<div
					className="wp-org-viewport wp-org-chart-viewport"
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
					{!head ? (
						<div className="wp-empty">No people are recorded yet. Plan your first team.</div>
					) : (
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
												data-active={selected === edge.from || selected === edge.to || undefined}
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
											data-person={id}
											aria-label={`${person.character.name}'s branch`}
											tabIndex={-1}
											onContextMenu={(event) => personMenu(event, id)}
											className={`wp-org-tree-node${selected === id ? " wp-org-selected" : ""}${person.home ? " wp-org-home" : ""}${canDrop(person) ? " wp-org-drop-target" : ""}`}
											style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
											{...dragProps(person)}
										>
											<button
												type="button"
												className="wp-org-person"
												aria-label={`View profile: ${person.character.name}`}
												onContextMenu={(event) => personMenu(event, id)}
												onKeyDown={(event) => personMenu(event, id)}
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
			{split.separator}
			<section ref={split.ref} className="wp-org-directory" aria-label="People directory">
				<div className="wp-org-directory-toolbar">
					<h2>
						People <span>{people.length}</span>
					</h2>
					<input
						type="search"
						aria-label="Filter people"
						placeholder="Filter by name or role"
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
					/>
					<button
						type="button"
						disabled={!departure && (!chosen.length || !world.connected || busy || !window.agentWorkplace.retirePeople)}
						title={chosen.length ? `${chosen.length} selected` : "Select people for a batch action"}
						onClick={(event) => {
							if (!departure)
								setDeparture({
									id: crypto.randomUUID(),
									trigger: event.currentTarget,
									people: chosen.map((person) => ({
										person: person.character.id,
										name: person.character.name,
										manager: person.character.role === "coordinator",
									})),
								});
							setDepartureOpen(true);
						}}
					>
						{departure ? "Departure progress" : "Let go"}
					</button>
				</div>
				<div className="wp-org-directory-scroll" ref={directory}>
					<table aria-label="People">
						<thead>
							<tr>
								<th scope="col">
									<input
										type="checkbox"
										aria-label="Select all people"
										disabled={!!departure || !people.length}
										checked={people.length > 0 && chosen.length === people.length}
										ref={(input) => {
											if (input) input.indeterminate = chosen.length > 0 && chosen.length < people.length;
										}}
										onChange={(event) =>
											setChecked(new Set(event.target.checked ? people.map((person) => person.character.id) : []))
										}
									/>
								</th>
								<th scope="col">Name</th>
								<th scope="col">Status</th>
								<th scope="col">Reports to</th>
								<th scope="col">Actions</th>
							</tr>
						</thead>
						<tbody>
							{listed.map((person) => {
								const id = person.character.id;
								const manager = nameOf(person.parent);
								return (
									<tr
										key={id}
										data-person={id}
										data-selected={selected === id || checked.has(id)}
										{...dragProps(person)}
									>
										<td>
											<input
												type="checkbox"
												aria-label={`Select ${person.character.name}`}
												checked={checked.has(id)}
												disabled={!!departure}
												onChange={(event) =>
													setChecked((previous) => {
														const next = new Set(previous);
														if (event.target.checked) next.add(id);
														else next.delete(id);
														return next;
													})
												}
											/>
										</td>
										<td>
											<button
												type="button"
												className="wp-org-directory-person"
												title={`View profile: ${person.character.name}`}
												aria-label={person.character.name}
												onClick={(event) => select(id, event.currentTarget)}
											>
												<PersonAvatar
													id={id}
													name={person.character.name}
													interactive={false}
													presence={presenceOf(person.character, person.home)}
												/>
												<span className="wp-org-directory-identity">
													<strong className="wp-org-directory-name">{person.character.name}</strong>
													<small className="wp-org-directory-role">
														{person.character.facts?.title ?? "Pi session"}
													</small>
												</span>
											</button>
										</td>
										<td>
											<span className="wp-org-directory-state" data-home={person.home}>
												{person.home ? "Away" : sessionStatus(person.character)}
											</span>
										</td>
										<td title={manager}>{manager ?? "Head"}</td>
										<td>
											<div className="wp-org-directory-actions">
												<button
													type="button"
													className="wp-org-directory-message"
													aria-label={`Message ${person.character.name}`}
													title={`Message ${person.character.name}`}
													onClick={() => openDM(id)}
												>
													<Icon name="chat" />
												</button>
												<PersonActionsButton id={id} />
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					{!listed.length && <p className="wp-empty">No one matches “{filter}”.</p>}
				</div>
			</section>
			{departure && (
				<DepartureDialog
					key={departure.id}
					selection={departure}
					open={departureOpen}
					connected={world.connected}
					onUnsettled={onDepartureChange}
					onHide={() => setDepartureOpen(false)}
					onClose={() => {
						setDeparture(undefined);
						setDepartureOpen(false);
						setChecked(new Set());
					}}
				/>
			)}
		</div>
	);
}

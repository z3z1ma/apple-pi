import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	type Simulation,
	type SimulationNodeDatum,
} from "d3-force";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeGraph, KnowledgeNode } from "../src/knowledge.js";

type Point = KnowledgeNode & SimulationNodeDatum;
type Camera = { x: number; y: number; scale: number };
const initialCamera: Camera = { x: 0, y: 0, scale: 1 };

function groupColor(group: string): string {
	let hue = 0;
	for (const character of group) hue = (hue * 31 + character.charCodeAt(0)) % 360;
	return `hsl(${hue} 62% 48%)`;
}

export function KnowledgeGraphView({
	graph,
	active,
	selected,
	onSelect,
}: {
	graph: KnowledgeGraph;
	active: boolean;
	selected?: string;
	onSelect(id: string): void;
}) {
	const svg = useRef<SVGSVGElement>(null);
	const points = useRef<Point[]>([]);
	const simulation = useRef<Simulation<Point, undefined>>(undefined);
	const [, redraw] = useState(0);
	const [hover, setHover] = useState<string>();
	const [camera, setCamera] = useState(initialCamera);
	const interacted = useRef(false);
	const drag = useRef<{ point?: Point; x: number; y: number; camera: Camera; moved: boolean }>(undefined);
	const fitGraph = useCallback(() => {
		const nodes = points.current;
		if (!nodes.length) return;
		const left = Math.min(...nodes.map((node) => node.x ?? 0)) - 60;
		const right = Math.max(...nodes.map((node) => node.x ?? 0)) + 60;
		const top = Math.min(...nodes.map((node) => node.y ?? 0)) - 40;
		const bottom = Math.max(...nodes.map((node) => node.y ?? 0)) + 40;
		const scale = Math.min(1000 / (right - left), 700 / (bottom - top));
		setCamera({ scale, x: 500 - ((left + right) / 2) * scale, y: 350 - ((top + bottom) / 2) * scale });
	}, []);
	useEffect(() => {
		points.current = graph.nodes.map((node) => ({ ...node }));
		interacted.current = false;
		setCamera(initialCamera);
		const engine = forceSimulation(points.current)
			.force(
				"link",
				forceLink<Point, { source: string; target: string }>(
					graph.edges.map((edge) => ({ source: edge.from, target: edge.to })),
				)
					.id((node) => node.id)
					.distance(90),
			)
			.force("charge", forceManyBody().strength(-160))
			.force("collide", forceCollide(22))
			.force("center", forceCenter(500, 350))
			.on("tick", () => {
				if (!interacted.current) fitGraph();
				redraw((version) => version + 1);
			})
			.on("end", () => {
				if (!interacted.current) fitGraph();
			});
		simulation.current = engine;
		return () => {
			engine.stop();
		};
	}, [graph, fitGraph]);
	useEffect(() => {
		if (active) simulation.current?.restart();
		else simulation.current?.stop();
	}, [active]);
	useEffect(() => {
		const point = points.current.find((node) => node.id === selected);
		if (!point || selected === undefined) return;
		interacted.current = true;
		setCamera((camera) => ({
			...camera,
			x: 500 - (point.x ?? 0) * camera.scale,
			y: 350 - (point.y ?? 0) * camera.scale,
		}));
	}, [selected]);
	const lit = hover ?? selected;
	const neighbours = new Set(lit ? [lit] : []);
	for (const edge of graph.edges) {
		if (edge.from === lit) neighbours.add(edge.to);
		if (edge.to === lit) neighbours.add(edge.from);
	}
	const byId = new Map(points.current.map((point) => [point.id, point]));
	const local = (clientX: number, clientY: number) => {
		const matrix = svg.current?.getScreenCTM()?.inverse();
		return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix) : new DOMPoint(clientX, clientY);
	};
	return (
		<div className="wp-knowledge-graph">
			<div className="wp-knowledge-graph-actions">
				<button
					type="button"
					aria-label="Zoom in"
					onClick={() => {
						interacted.current = true;
						setCamera((c) => ({ scale: c.scale * 1.25, x: 500 + (c.x - 500) * 1.25, y: 350 + (c.y - 350) * 1.25 }));
					}}
				>
					+
				</button>
				<button
					type="button"
					aria-label="Zoom out"
					onClick={() => {
						interacted.current = true;
						setCamera((c) => ({ scale: c.scale / 1.25, x: 500 + (c.x - 500) / 1.25, y: 350 + (c.y - 350) / 1.25 }));
					}}
				>
					-
				</button>
				<button
					type="button"
					onClick={() => {
						interacted.current = true;
						fitGraph();
					}}
				>
					Fit graph
				</button>
			</div>
			<svg
				ref={svg}
				viewBox="0 0 1000 700"
				aria-label="Knowledge graph"
				onWheel={(event) => {
					event.preventDefault();
					interacted.current = true;
					const at = local(event.clientX, event.clientY);
					const factor = Math.exp(-event.deltaY / 500);
					setCamera((c) => ({
						scale: c.scale * factor,
						x: at.x + (c.x - at.x) * factor,
						y: at.y + (c.y - at.y) * factor,
					}));
				}}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					interacted.current = true;
					const at = local(event.clientX, event.clientY);
					drag.current = { x: at.x, y: at.y, camera, moved: false };
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					const current = drag.current;
					if (!current) return;
					const at = local(event.clientX, event.clientY);
					const dx = at.x - current.x;
					const dy = at.y - current.y;
					if (Math.hypot(dx, dy) > 3) current.moved = true;
					if (current.point) {
						current.point.fx = (at.x - camera.x) / camera.scale;
						current.point.fy = (at.y - camera.y) / camera.scale;
						simulation.current?.alphaTarget(0.2).restart();
					} else setCamera({ ...current.camera, x: current.camera.x + dx, y: current.camera.y + dy });
				}}
				onPointerUp={() => {
					const current = drag.current;
					if (current?.point) {
						if (!current.moved) onSelect(current.point.id);
						current.point.fx = null;
						current.point.fy = null;
						simulation.current?.alphaTarget(0);
					}
					drag.current = undefined;
				}}
				onPointerCancel={() => {
					if (drag.current?.point) {
						drag.current.point.fx = null;
						drag.current.point.fy = null;
					}
					drag.current = undefined;
					simulation.current?.alphaTarget(0);
				}}
			>
				<title>Repository knowledge. Drag the background to pan, scroll to zoom, and drag nodes to arrange them.</title>
				<g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
					{graph.edges.map((edge) => {
						const from = byId.get(edge.from);
						const to = byId.get(edge.to);
						return (
							<line
								key={JSON.stringify(edge)}
								className={`wp-knowledge-edge is-${edge.kind}`}
								opacity={lit && edge.from !== lit && edge.to !== lit ? 0.12 : 0.7}
								x1={from?.x}
								y1={from?.y}
								x2={to?.x}
								y2={to?.y}
							/>
						);
					})}
					{points.current.map((point) => (
						// biome-ignore lint/a11y/useSemanticElements: SVG graph nodes use keyboard-activated groups
						<g
							key={point.id}
							role="button"
							tabIndex={0}
							aria-label={`Read ${point.path}`}
							aria-pressed={selected === point.id}
							className={`wp-knowledge-node${point.kind === "missing" ? " is-missing" : ""}${selected === point.id ? " is-selected" : ""}`}
							transform={`translate(${point.x ?? 0} ${point.y ?? 0})`}
							opacity={lit && !neighbours.has(point.id) ? 0.25 : 1}
							onPointerEnter={() => setHover(point.id)}
							onPointerLeave={() => setHover(undefined)}
							onPointerDown={(event) => {
								if (event.button !== 0) return;
								event.stopPropagation();
								interacted.current = true;
								const at = local(event.clientX, event.clientY);
								drag.current = { point, x: at.x, y: at.y, camera, moved: false };
								svg.current?.setPointerCapture(event.pointerId);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									onSelect(point.id);
								}
							}}
						>
							<title>
								{point.path} ({point.kind})
							</title>
							<circle
								vectorEffect="non-scaling-stroke"
								r={(selected === point.id ? 9 : 6) / camera.scale}
								fill={groupColor(point.group)}
							/>
							<text
								x={12 / camera.scale}
								y={4 / camera.scale}
								style={{ fontSize: 14 / camera.scale, strokeWidth: 3 / camera.scale }}
								className={lit && !neighbours.has(point.id) ? "is-quiet" : undefined}
							>
								{point.label}
							</text>
						</g>
					))}
				</g>
			</svg>
			<div className="wp-knowledge-legend">
				<span className="is-coupled">Coupled</span>
				<span className="is-verify">Verify</span>
				<span className="is-wiki">Wiki</span>
				<span>Node colour: folder</span>
				<span>Hollow: missing</span>
			</div>
		</div>
	);
}

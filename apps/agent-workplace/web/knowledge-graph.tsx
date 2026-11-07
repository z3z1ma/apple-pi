import {
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type Simulation,
	type SimulationNodeDatum,
} from "d3-force";
import { useEffect, useMemo, useRef } from "react";
import type { KnowledgeGraph, KnowledgeNode } from "../src/knowledge.js";

type Point = KnowledgeNode & SimulationNodeDatum & { degree: number; radius: number; colour: number };
type Link = { source: Point; target: Point };
type Camera = { x: number; y: number; scale: number };
type Star = { x: number; y: number; r: number; a: number };
type View = {
	points: Point[];
	links: Link[];
	neighbours: Map<string, Set<string>>;
	camera: Camera;
	follow: boolean;
	focus?: string;
	hover?: string;
	selected?: string;
	size: { width: number; height: number; ratio: number };
	stars: Star[];
	sprites: Map<string, HTMLCanvasElement>;
	dirty: boolean;
	simulation?: Simulation<Point, undefined>;
};
type Palette = {
	space: [string, string];
	stars: boolean;
	nodes: string[];
	edge: string;
	label: string;
	labelHalo: string;
	ring: string;
	glow: number;
	blend: GlobalCompositeOperation;
};
type Frame = {
	context: CanvasRenderingContext2D;
	view: View;
	palette: Palette;
	lit?: string;
	shown(id: string): boolean;
	at(point: Point): { x: number; y: number };
	radius(point: Point): number;
	visible(x: number, y: number, margin: number): boolean;
};

const DARK: Palette = {
	space: ["#151a36", "#05060c"],
	stars: true,
	nodes: ["#8ab4ff", "#c4a1ff", "#ff8fcf", "#6ee7d8", "#ffd27a", "#7dd3fc", "#b8f28a", "#ff9e9e", "#e2a8ff", "#9ef0ff"],
	edge: "rgba(160, 172, 230, 0.13)",
	label: "#e8ecff",
	labelHalo: "rgba(5, 6, 12, 0.85)",
	ring: "#ffffff",
	glow: 0.38,
	blend: "lighter",
};
const LIGHT: Palette = {
	space: ["#ffffff", "#e9ecf6"],
	stars: false,
	nodes: ["#3f63d6", "#7c4ddb", "#c93f8c", "#13897a", "#c07a12", "#1f86b8", "#4f8a1d", "#cf4b4b", "#a24bc9", "#167f99"],
	edge: "rgba(52, 60, 105, 0.10)",
	label: "#181c34",
	labelHalo: "rgba(246, 247, 252, 0.9)",
	ring: "#1b1f3a",
	glow: 0.22,
	blend: "source-over",
};
const LABEL_FONT = "500 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function hash(text: string): number {
	let value = 0;
	for (const character of text) value = (value * 31 + character.charCodeAt(0)) >>> 0;
	return value;
}

function cluster(node: KnowledgeNode): string {
	return node.group.split("/").slice(0, 3).join("/");
}

function glowSprite(colour: string): HTMLCanvasElement {
	const sprite = document.createElement("canvas");
	sprite.width = sprite.height = 64;
	const context = sprite.getContext("2d")!;
	const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
	gradient.addColorStop(0, colour);
	gradient.addColorStop(0.25, `${colour}88`);
	gradient.addColorStop(1, `${colour}00`);
	context.fillStyle = gradient;
	context.fillRect(0, 0, 64, 64);
	return sprite;
}

function starfield(width: number, height: number): Star[] {
	let seed = 7;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	return Array.from({ length: Math.round((width * height) / 5000) }, () => ({
		x: random() * width,
		y: random() * height,
		r: random() * 0.9 + 0.2,
		a: random() * 0.35 + 0.05,
	}));
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
	const canvas = useRef<HTMLCanvasElement>(null);
	const hits = useRef(new Map<string, HTMLButtonElement>());
	const state = useRef<View>({
		points: [],
		links: [],
		neighbours: new Map(),
		camera: { x: 0, y: 0, scale: 1 },
		follow: true,
		size: { width: 0, height: 0, ratio: 1 },
		stars: [],
		sprites: new Map(),
		dirty: true,
	});
	const onSelectRef = useRef(onSelect);
	onSelectRef.current = onSelect;
	state.current.selected = selected;

	const points = useMemo(() => {
		const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
		for (const edge of graph.edges) for (const id of [edge.from, edge.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
		const clusters = [...new Set(graph.nodes.map(cluster))].sort();
		return graph.nodes.map(
			(node): Point => ({
				...node,
				degree: degree.get(node.id) ?? 0,
				radius: 1.5 + Math.sqrt(degree.get(node.id) ?? 0) * 1.05,
				colour: (clusters.indexOf(cluster(node)) + hash(cluster(node))) % DARK.nodes.length,
			}),
		);
	}, [graph]);

	useEffect(() => {
		const view = state.current;
		const byId = new Map(points.map((point) => [point.id, point]));
		view.points = points;
		view.links = graph.edges
			.filter((edge) => byId.has(edge.from) && byId.has(edge.to))
			.map((edge) => ({ source: byId.get(edge.from)!, target: byId.get(edge.to)! }));
		view.neighbours = new Map(points.map((point) => [point.id, new Set<string>()]));
		for (const link of view.links) {
			view.neighbours.get(link.source.id)!.add(link.target.id);
			view.neighbours.get(link.target.id)!.add(link.source.id);
		}
		view.follow = true;
		const simulation = forceSimulation(points)
			.force(
				"link",
				forceLink<Point, Link>(view.links.map((link) => ({ ...link })))
					.distance((link) => 14 + (link.source.radius + link.target.radius) * 1.5)
					.strength((link) => 1 / Math.min(link.source.degree || 1, link.target.degree || 1)),
			)
			.force(
				"charge",
				forceManyBody<Point>()
					.strength((point) => -10 - point.radius * 5)
					.distanceMax(320),
			)
			.force("collide", forceCollide<Point>((point) => point.radius + 2).iterations(1))
			.force(
				"x",
				forceX<Point>(0).strength((point) => (point.degree ? 0.03 : 0.12)),
			)
			.force(
				"y",
				forceY<Point>(0).strength((point) => (point.degree ? 0.03 : 0.12)),
			)
			.alphaDecay(0.018)
			.velocityDecay(0.35)
			.on("tick", () => {
				view.dirty = true;
			});
		for (let tick = 0; tick < 40; tick++) simulation.tick();
		view.simulation = simulation;
		view.dirty = true;
		return () => {
			simulation.stop();
		};
	}, [graph, points]);

	useEffect(() => {
		const simulation = state.current.simulation;
		if (!simulation) return;
		if (active && simulation.alpha() > simulation.alphaMin()) simulation.restart();
		else if (!active) simulation.stop();
	}, [active]);

	useEffect(() => {
		const view = state.current;
		view.dirty = true;
		if (!selected) return;
		view.follow = false;
		view.focus = selected;
	}, [selected]);

	useEffect(() => {
		const element = canvas.current;
		if (!element || !active) return;
		const view = state.current;
		const resize = () => {
			const ratio = window.devicePixelRatio || 1;
			const width = element.clientWidth;
			const height = element.clientHeight;
			if (!width || !height) return;
			if (width !== view.size.width || height !== view.size.height) {
				view.stars = starfield(width, height);
				if (view.selected && !view.follow) view.focus = view.selected;
			}
			view.size = { width, height, ratio };
			element.width = Math.round(width * ratio);
			element.height = Math.round(height * ratio);
			view.dirty = true;
		};
		const resized = new ResizeObserver(resize);
		resized.observe(element);
		resize();
		const themed = new MutationObserver(() => {
			view.dirty = true;
		});
		const appearance = element.closest("[data-appearance]");
		if (appearance) themed.observe(appearance, { attributes: true, attributeFilter: ["data-appearance"] });
		let frame = 0;
		const draw = () => {
			frame = requestAnimationFrame(draw);
			if (!view.dirty) return;
			view.dirty = false;
			render(element, view, hits.current);
		};
		frame = requestAnimationFrame(draw);
		return () => {
			cancelAnimationFrame(frame);
			resized.disconnect();
			themed.disconnect();
		};
	}, [active]);

	const toGraph = (clientX: number, clientY: number) => {
		const box = canvas.current!.getBoundingClientRect();
		const { camera } = state.current;
		return { x: (clientX - box.left - camera.x) / camera.scale, y: (clientY - box.top - camera.y) / camera.scale };
	};
	const pick = (clientX: number, clientY: number) => {
		const at = toGraph(clientX, clientY);
		const { simulation, camera } = state.current;
		return simulation?.find(at.x, at.y, 10 / camera.scale + 6);
	};
	const zoom = (factor: number, centreX: number, centreY: number) => {
		const view = state.current;
		view.follow = false;
		const scale = Math.min(8, Math.max(0.05, view.camera.scale * factor));
		const applied = scale / view.camera.scale;
		view.camera = {
			scale,
			x: centreX + (view.camera.x - centreX) * applied,
			y: centreY + (view.camera.y - centreY) * applied,
		};
		view.dirty = true;
	};
	const drag = useRef<{ point?: Point; x: number; y: number; camera: Camera; moved: boolean }>(undefined);
	const release = () => {
		const point = drag.current?.point;
		if (point) {
			point.fx = null;
			point.fy = null;
			state.current.simulation?.alphaTarget(0);
		}
		drag.current = undefined;
	};

	return (
		<div className="wp-knowledge-graph">
			<canvas
				ref={canvas}
				aria-label="Knowledge graph"
				role="img"
				onWheel={(event) => {
					const box = event.currentTarget.getBoundingClientRect();
					zoom(Math.exp(-event.deltaY / 400), event.clientX - box.left, event.clientY - box.top);
				}}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					const point = pick(event.clientX, event.clientY);
					drag.current = { point, x: event.clientX, y: event.clientY, camera: state.current.camera, moved: false };
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					const view = state.current;
					const current = drag.current;
					if (!current) {
						const hover = pick(event.clientX, event.clientY)?.id;
						if (hover !== view.hover) {
							view.hover = hover;
							view.dirty = true;
							event.currentTarget.style.cursor = hover ? "pointer" : "grab";
						}
						return;
					}
					const dx = event.clientX - current.x;
					const dy = event.clientY - current.y;
					if (Math.hypot(dx, dy) > 3) current.moved = true;
					if (!current.moved) return;
					view.follow = false;
					if (current.point) {
						const at = toGraph(event.clientX, event.clientY);
						current.point.fx = at.x;
						current.point.fy = at.y;
						view.simulation?.alphaTarget(0.25).restart();
					} else {
						view.camera = { ...current.camera, x: current.camera.x + dx, y: current.camera.y + dy };
						event.currentTarget.style.cursor = "grabbing";
					}
					view.dirty = true;
				}}
				onPointerUp={(event) => {
					const current = drag.current;
					release();
					event.currentTarget.style.cursor = state.current.hover ? "pointer" : "grab";
					if (current?.point && !current.moved) onSelectRef.current(current.point.id);
				}}
				onPointerLeave={() => {
					if (drag.current) return;
					state.current.hover = undefined;
					state.current.dirty = true;
				}}
				onPointerCancel={release}
			/>
			<fieldset className="wp-knowledge-hits" aria-label="Graph nodes">
				{points.map((point) => (
					<button
						key={point.id}
						type="button"
						tabIndex={-1}
						aria-label={`Read ${point.path}`}
						aria-pressed={selected === point.id}
						data-degree={point.degree}
						ref={(element) => {
							if (element) hits.current.set(point.id, element);
							else hits.current.delete(point.id);
						}}
						onClick={() => onSelect(point.id)}
					/>
				))}
			</fieldset>
			<div className="wp-knowledge-graph-actions">
				<button
					type="button"
					aria-label="Zoom in"
					onClick={() => zoom(1.3, state.current.size.width / 2, state.current.size.height / 2)}
				>
					+
				</button>
				<button
					type="button"
					aria-label="Zoom out"
					onClick={() => zoom(1 / 1.3, state.current.size.width / 2, state.current.size.height / 2)}
				>
					−
				</button>
				<button
					type="button"
					onClick={() => {
						state.current.follow = true;
						state.current.dirty = true;
					}}
				>
					Fit graph
				</button>
			</div>
			<div className="wp-knowledge-legend">
				{[...new Set(graph.edges.map((edge) => edge.kind))].map((kind) => (
					<span key={kind} className={`is-${kind}`}>
						{kind === "coupled" ? "Coupled" : kind === "verify" ? "Verify" : "Wiki"}
					</span>
				))}
				<span>Size: links · Colour: folder</span>
			</div>
		</div>
	);
}

function framing(view: View): Camera | undefined {
	if (!view.points.length || !view.size.width) return;
	const xs = view.points.map((point) => point.x ?? 0);
	const ys = view.points.map((point) => point.y ?? 0);
	const left = Math.min(...xs);
	const right = Math.max(...xs);
	const top = Math.min(...ys);
	const bottom = Math.max(...ys);
	const pad = 60;
	const scale = Math.min(
		4,
		(view.size.width - pad * 2) / Math.max(1, right - left),
		(view.size.height - pad * 2) / Math.max(1, bottom - top),
	);
	return {
		scale,
		x: view.size.width / 2 - ((left + right) / 2) * scale,
		y: view.size.height / 2 - ((top + bottom) / 2) * scale,
	};
}

function follow(view: View) {
	const focus = view.points.find((point) => point.id === view.focus);
	view.focus = undefined;
	if (focus) {
		const scale = Math.max(view.camera.scale, 1.4);
		view.camera = {
			scale,
			x: view.size.width / 2 - (focus.x ?? 0) * scale,
			y: view.size.height / 2 - (focus.y ?? 0) * scale,
		};
		return;
	}
	const target = view.follow ? framing(view) : undefined;
	if (!target) return;
	const settling = view.simulation !== undefined && view.simulation.alpha() > 0.02;
	const blend = settling ? 0.18 : 1;
	view.camera = {
		scale: view.camera.scale + (target.scale - view.camera.scale) * blend,
		x: view.camera.x + (target.x - view.camera.x) * blend,
		y: view.camera.y + (target.y - view.camera.y) * blend,
	};
	if (settling) view.dirty = true;
}

function drawSpace({ context, view, palette }: Frame) {
	const { width, height } = view.size;
	const space = context.createRadialGradient(
		width / 2,
		height / 2,
		0,
		width / 2,
		height / 2,
		Math.hypot(width, height) / 1.6,
	);
	space.addColorStop(0, palette.space[0]);
	space.addColorStop(1, palette.space[1]);
	context.globalCompositeOperation = "source-over";
	context.globalAlpha = 1;
	context.fillStyle = space;
	context.fillRect(0, 0, width, height);
	if (!palette.stars) return;
	context.fillStyle = "#ffffff";
	for (const star of view.stars) {
		context.globalAlpha = star.a;
		context.beginPath();
		context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
		context.fill();
	}
	context.globalAlpha = 1;
}

function drawLinks({ context, view, palette, lit, at }: Frame) {
	const touches = (link: Link) => link.source.id === lit || link.target.id === lit;
	context.lineWidth = Math.max(0.5, Math.min(1, view.camera.scale * 0.8));
	context.strokeStyle = palette.edge;
	context.globalAlpha = lit ? 0.35 : 1;
	context.beginPath();
	for (const link of view.links) {
		if (touches(link)) continue;
		const from = at(link.source);
		const to = at(link.target);
		context.moveTo(from.x, from.y);
		context.lineTo(to.x, to.y);
	}
	context.stroke();
	context.lineWidth = 1.4;
	context.globalAlpha = 0.75;
	for (const link of lit ? view.links.filter(touches) : []) {
		const other = link.source.id === lit ? link.target : link.source;
		const from = at(link.source);
		const to = at(link.target);
		context.strokeStyle = palette.nodes[other.colour]!;
		context.beginPath();
		context.moveTo(from.x, from.y);
		context.lineTo(to.x, to.y);
		context.stroke();
	}
	context.globalAlpha = 1;
}

function drawGlow({ context, view, palette, shown, at, radius, visible }: Frame) {
	context.globalCompositeOperation = palette.blend;
	for (const point of view.points) {
		if (point.kind === "missing") continue;
		const colour = palette.nodes[point.colour]!;
		let sprite = view.sprites.get(colour);
		if (!sprite) {
			sprite = glowSprite(colour);
			view.sprites.set(colour, sprite);
		}
		const { x, y } = at(point);
		const size = radius(point) * 4.5;
		if (!visible(x, y, size)) continue;
		context.globalAlpha = palette.glow * (shown(point.id) ? 1 : 0.15);
		context.drawImage(sprite, x - size, y - size, size * 2, size * 2);
	}
	context.globalCompositeOperation = "source-over";
	context.globalAlpha = 1;
}

function drawNodes(
	{ context, view, palette, shown, at, radius, visible }: Frame,
	hits: Map<string, HTMLButtonElement>,
) {
	for (const point of view.points) {
		const { x, y } = at(point);
		const r = radius(point);
		const hit = hits.get(point.id);
		if (hit) {
			hit.style.transform = `translate(${x - r - 3}px, ${y - r - 3}px)`;
			hit.style.width = hit.style.height = `${r * 2 + 6}px`;
		}
		if (!visible(x, y, r)) continue;
		context.globalAlpha = shown(point.id) ? 1 : 0.18;
		context.beginPath();
		context.arc(x, y, r, 0, Math.PI * 2);
		if (point.kind === "missing") {
			context.lineWidth = 1;
			context.strokeStyle = palette.nodes[point.colour]!;
			context.stroke();
		} else {
			context.fillStyle = palette.nodes[point.colour]!;
			context.fill();
		}
		if (point.id !== view.selected && point.id !== view.hover) continue;
		context.lineWidth = 1.5;
		context.strokeStyle = palette.ring;
		context.beginPath();
		context.arc(x, y, r + 3, 0, Math.PI * 2);
		context.stroke();
	}
	context.globalAlpha = 1;
}

function drawLabels({ context, view, palette, lit, shown, at, radius }: Frame) {
	const { width, height } = view.size;
	context.font = LABEL_FONT;
	context.textAlign = "center";
	context.textBaseline = "top";
	context.lineJoin = "round";
	context.lineWidth = 3;
	const taken: { left: number; right: number; top: number; bottom: number }[] = [];
	const candidates = view.points
		.map((point) => {
			const forced = lit !== undefined && shown(point.id);
			const reach = radius(point) * Math.sqrt(view.camera.scale);
			const alpha = forced ? 1 : lit ? 0 : Math.min(1, Math.max(0, (reach - 5) / 2));
			return { point, alpha, priority: (point.id === lit ? 1e7 : 0) + (forced ? 1e6 : 0) + point.degree };
		})
		.filter((candidate) => candidate.alpha > 0.02)
		.sort((a, b) => b.priority - a.priority);
	for (const { point, alpha } of candidates) {
		const { x, y } = at(point);
		const half = context.measureText(point.label).width / 2 + 3;
		const top = y + radius(point) + 3;
		const box = { left: x - half, right: x + half, top, bottom: top + 14 };
		if (box.right < 0 || box.left > width || box.bottom < 0 || box.top > height) continue;
		if (taken.some((o) => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top))
			continue;
		taken.push(box);
		context.globalAlpha = alpha;
		context.strokeStyle = palette.labelHalo;
		context.strokeText(point.label, x, top + 1);
		context.fillStyle = palette.label;
		context.fillText(point.label, x, top + 1);
	}
	context.globalAlpha = 1;
}

function render(element: HTMLCanvasElement, view: View, hits: Map<string, HTMLButtonElement>) {
	const context = element.getContext("2d");
	if (!context || !view.size.width) return;
	follow(view);
	const { width, height, ratio } = view.size;
	const { camera } = view;
	const lit = view.hover ?? view.selected;
	const near = lit ? view.neighbours.get(lit) : undefined;
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	const frame: Frame = {
		context,
		view,
		palette: element.closest("[data-appearance='light']") ? LIGHT : DARK,
		lit,
		shown: (id) => !lit || id === lit || near?.has(id) === true,
		at: (point) => ({ x: camera.x + (point.x ?? 0) * camera.scale, y: camera.y + (point.y ?? 0) * camera.scale }),
		radius: (point) => Math.max(1.4, point.radius * Math.sqrt(camera.scale)),
		visible: (x, y, margin) => x > -margin && y > -margin && x < width + margin && y < height + margin,
	};
	drawSpace(frame);
	drawLinks(frame);
	drawGlow(frame);
	drawNodes(frame, hits);
	drawLabels(frame);
}

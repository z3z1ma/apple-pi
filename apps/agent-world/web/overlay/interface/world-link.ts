// How the world tells the interface what the minimap shows: on each frame-ish tick, the current place, the characters'
// and the avatar's positions, and the part of the place on screen, published to the view store only when they change.
// It reads the scene only through its read-only views, the same ones the headless tests use.
import { themeStore } from "../../theme-store.js";
import type { MinimapView, ViewStore } from "../../view-state.js";
import type { WorldStore } from "../../world-store.js";
import { minimapFor } from "./minimap-source.js";

/** The scene's read-only views the minimap needs. */
export interface MinimapScene {
	placeKey(): string;
	figureViews(): { id: string; x: number; y: number }[];
	avatarView?(): { x: number; y: number } | undefined;
	/** A point on screen in CSS px, in tiles. */
	toWorld?(point: [number, number]): [number, number];
	walkGridShown(): boolean;
}

const TICK_MS = 150;
const round = (n: number) => Math.round(n * 20) / 20;

/** Publish the minimap and the walk grid's state while the page lives; returns a function that stops it. */
export function publishMinimap(view: ViewStore, store: WorldStore, scene: () => MinimapScene | undefined): () => void {
	let last = "";
	const tick = () => {
		const active = scene();
		const theme = themeStore.get();
		if (!active || !theme) return;
		const avatar = active.avatarView?.();
		const dots: MinimapView["dots"] = [
			...active.figureViews().map((f) => ({ id: f.id, kind: "agent" as const, x: round(f.x), y: round(f.y) })),
			...(avatar ? [{ id: "avatar", kind: "avatar" as const, x: round(avatar.x), y: round(avatar.y) }] : []),
		];
		let shown: MinimapView["view"];
		if (active.toWorld) {
			const [x0, y0] = active.toWorld([0, 0]);
			const [x1, y1] = active.toWorld([window.innerWidth, window.innerHeight]);
			shown = { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
		}
		const minimap = minimapFor(active.placeKey(), store.get(), theme, dots, shown);
		const walkGrid = active.walkGridShown();
		const signature = JSON.stringify([minimap, walkGrid]);
		if (signature === last) return;
		last = signature;
		view.update({ minimap, walkGrid });
	};
	const timer = setInterval(tick, TICK_MS);
	tick();
	return () => clearInterval(timer);
}

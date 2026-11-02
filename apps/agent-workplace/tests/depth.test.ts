import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIDGETS, pngSize, type ThemeManifest } from "../src/theme-pack.js";
import { fidgetSlots, surfaceOf } from "../web/game/fidget-spots.js";
import { gridFor, isOpen } from "../web/game/pathing.js";
import type { PlaceData, Point, Rect } from "../web/theme.js";

// Depth and grounding (ticket 02 of the alive pass): nobody floats or is cut by something behind them. The scene draws
// a foreground piece over anyone whose feet are north of its `feet` line, so a piece may only cover open floor that
// lies behind its furniture (a footprint south of it in the same column) or right beside it, never floor in front of
// or around it (a fountain basin's corners, the strip between a table's footprint and a feet line drawn lower). Hosts
// stand on open floor, and a fidget on furniture is never drawn under a piece.
const themesDir = fileURLToPath(new URL("../themes/", import.meta.url));
const themes = readdirSync(themesDir).filter((theme) => existsSync(`${themesDir}${theme}/places`));
const read = <T>(path: string): T => JSON.parse(readFileSync(`${themesDir}${path}`, "utf8"));
const places = themes.flatMap((theme) =>
	readdirSync(`${themesDir}${theme}/places`)
		.filter((file) => file.endsWith(".json"))
		.map((file) => [theme, file.slice(0, -".json".length)] as [string, string]),
);

/** How far inside a piece's sides a foot must be before the piece hides it (a body is wider than its feet). */
const INSIDE = 0.15;
/** How far past a footprint's side a piece may still hide someone beside it (the furniture's own overhang). */
const OVERHANG = 0.2;
/** The walk grid's half-tile cells let a foot stand up to a quarter tile inside a footprint's traced edge. */
const CELL_SLACK = 0.25;
const STEP = 0.1;

/** Open feet points a piece hides that lie in front of its furniture, neither behind it nor beside it. */
function exposed(place: PlaceData, { rect: [x, y, w], feet }: { rect: Rect; feet: number }): Point[] {
	const grid = gridFor(place);
	const bad: Point[] = [];
	for (let fx = x + INSIDE; fx <= x + w - INSIDE + 1e-9; fx += STEP)
		for (let fy = y; fy < feet - 1e-9; fy += STEP) {
			const at: Point = [fx, fy];
			if (!isOpen(grid, at)) continue;
			// In front of the piece's furniture: a footprint that starts inside the piece lies north of the foot in its column.
			// (Open floor beside a tree's trunk, under its canopy, is behind the canopy, so it may be hidden.)
			const inFront = place.blocked.some(
				([bx, by, bw]) => fx >= bx - INSIDE && fx <= bx + bw + INSIDE && by < fy && by >= y - 1e-9,
			);
			if (!inFront) continue;
			const behind = place.blocked.some(
				([bx, by, bw]) => fx >= bx - INSIDE && fx <= bx + bw + INSIDE && by >= fy - CELL_SLACK && by <= feet + 0.05,
			);
			const beside = place.blocked.some(
				([bx, by, bw, bh]) =>
					((fx >= bx - OVERHANG && fx <= bx + CELL_SLACK) ||
						(fx >= bx + bw - CELL_SLACK && fx <= bx + bw + OVERHANG)) &&
					fy >= by - 1e-9 &&
					fy <= by + bh + 1e-9,
			);
			if (!behind && !beside) bad.push([Math.round(fx * 100) / 100, Math.round(fy * 100) / 100]);
		}
	return bad;
}

describe.each(places)("%s/%s", (theme, name) => {
	const place = read<PlaceData>(`${theme}/places/${name}.json`);

	// The gallery is drawn from cut strips, which draw no foreground pieces.
	it.skipIf(!!place.niches)("draws no foreground piece over floor in front of or around its furniture", () => {
		for (const piece of place.foreground ?? []) expect(exposed(place, piece), `piece ${piece.rect}`).toEqual([]);
	});

	it("stands its host on open floor", () => {
		if (place.host) expect(isOpen(gridFor(place), place.host.at), `host at ${place.host.at}`).toBe(true);
	});

	it("draws every fidget on furniture over the furniture, never under a piece", () => {
		const manifest = read<ThemeManifest>(`${theme}/theme.json`);
		const grid = gridFor(place);
		for (const slot of fidgetSlots(place)) {
			const [x, y] = slot.at;
			if (isOpen(grid, slot.at)) continue;
			// On furniture or a wall shelf: its base is on a footprint, and every piece in front of it is its surface.
			expect(
				place.blocked.some(([bx, by, bw, bh]) => x >= bx && x <= bx + bw && y >= by && y <= by + bh),
				`${slot.fidget} at ${slot.at} stands on furniture`,
			).toBe(true);
			const kind = FIDGETS[slot.fidget!];
			const w = slot.w ?? manifest.fidgets?.[slot.fidget!]?.w ?? kind.w;
			const size = pngSize(readFileSync(`${themesDir}${theme}/overlays/${kind.art[0]}.png`));
			const h = size ? (w * size.height) / size.width : w;
			const depth = surfaceOf(place, slot.at)?.feet ?? y;
			for (const piece of place.foreground ?? []) {
				const [px, py, pw, ph] = piece.rect;
				const overlaps = px < x + w / 2 && px + pw > x - w / 2 && py < y && py + ph > y - h;
				expect(overlaps && piece.feet > depth, `${slot.fidget} at ${slot.at} under piece ${piece.rect}`).toBe(false);
			}
		}
	});
});

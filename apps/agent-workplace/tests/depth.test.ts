import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIDGETS, pngSize, type ThemeManifest } from "../src/theme-pack.js";
import { fidgetSlots, surfaceOf } from "../web/game/fidget-spots.js";
import { gridFor, isOpen } from "../web/game/pathing.js";
import type { PlaceData, Point, Rect } from "../web/theme.js";

const themesDir = fileURLToPath(new URL("../themes/", import.meta.url));
const themes = readdirSync(themesDir).filter((theme) => existsSync(`${themesDir}${theme}/places`));
const read = <T>(path: string): T => JSON.parse(readFileSync(`${themesDir}${path}`, "utf8"));
const places = themes.flatMap((theme) =>
	readdirSync(`${themesDir}${theme}/places`)
		.filter((file) => file.endsWith(".json"))
		.map((file) => [theme, file.slice(0, -".json".length)] as [string, string]),
);

const INSIDE = 0.15;
const OVERHANG = 0.2;
const CELL_SLACK = 0.25;
const STEP = 0.1;

function exposed(place: PlaceData, { rect: [x, y, w], feet }: { rect: Rect; feet: number }): Point[] {
	const grid = gridFor(place);
	const bad: Point[] = [];
	for (let fx = x + INSIDE; fx <= x + w - INSIDE + 1e-9; fx += STEP)
		for (let fy = y; fy < feet - 1e-9; fy += STEP) {
			const at: Point = [fx, fy];
			if (!isOpen(grid, at)) continue;
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

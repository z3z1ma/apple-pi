import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeStrips, stripsFor } from "../web/game/layout.js";
import { findPath, gridFor, isOpen } from "../web/game/pathing.js";
import { PLACE_FILES, type PlaceData, type Point } from "../web/theme.js";

// The fantasy pack's hand-traced place data, checked the way the avatar uses it: from every way in, it can walk to
// every spot and every door, and every overlay slot sits inside its painting.
const fantasy = (name: string): PlaceData =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/fantasy/places/${name}.json`, import.meta.url)), "utf8"));

/** Each place as drawn: the gallery with seven niches (two repeats of its painted section). */
const places: [string, PlaceData][] = PLACE_FILES.map((name) => {
	const place = fantasy(name);
	if (!place.niches) return [name, place];
	const strips = stripsFor(place.niches, 7);
	const composed = composeStrips(place, strips);
	// The wing doors stand in the niches; where one stands to use each door.
	const niches = strips.flatMap((strip, i) =>
		place
			.niches!.at.filter((x) => x >= strip.from && (x < strip.to || i === strips.length - 1))
			.map((x) => x - strip.from + strip.at),
	);
	const standAt = place.niches!.standAt;
	const doors = niches.map((x, i) => ({
		name: `wing ${i}`,
		rect: [x - 1.6, 2.2, 3.2, 4.4] as [number, number, number, number],
		standAt: [x + standAt[0], standAt[1]] as Point,
		to: "wing",
	}));
	return [`${name} (7 wings)`, { ...composed, doors: [...composed.doors, ...doors] }];
});

const near = (a: Point, b: Point, within = 0.05) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= within;

describe.each(places)("%s", (_name, place) => {
	const ways = Object.entries(place.entries);

	it("has its spots, entries, and door stand points on open floor", () => {
		const grid = gridFor(place);
		for (const point of [...place.spots, ...ways.map(([, p]) => p), ...place.doors.map((d) => d.standAt)])
			expect(isOpen(grid, point), `${point}`).toBe(true);
	});

	it("lets the avatar walk from every way in to every spot and every door, with everyone at their spots", () => {
		const empty = gridFor(place);
		const full = gridFor(place, place.spots);
		for (const [way, from] of ways) {
			for (const spot of place.spots) {
				const path = findPath(empty, from, spot);
				expect(path && near(path.goal, spot), `${way} -> spot ${spot}`).toBe(true);
			}
			for (const door of place.doors) {
				const path = findPath(full, from, door.standAt);
				expect(path && near(path.goal, door.standAt), `${way} -> ${door.name}`).toBe(true);
			}
		}
	});

	it("names a door characters come and go by, and keeps its overlay slots and furniture inside the painting", () => {
		if (place.spots.length) expect(place.doors.map((d) => d.name)).toContain(place.enterBy);
		for (const slot of place.overlaySlots) {
			expect(slot.at[0]).toBeGreaterThanOrEqual(0);
			expect(slot.at[0]).toBeLessThanOrEqual(place.cols);
			expect(slot.at[1]).toBeGreaterThanOrEqual(0);
			expect(slot.at[1]).toBeLessThanOrEqual(place.rows);
		}
		for (const { rect, feet } of place.foreground ?? []) {
			const [x, y, w, h] = rect;
			expect(x >= 0 && y >= 0 && x + w <= place.cols && y + h <= place.rows, `${rect}`).toBe(true);
			// A piece stands on the floor along its bottom edge.
			expect(Math.abs(y + h - feet), `${rect}`).toBeLessThan(0.15);
		}
	});
});

it("gives every place with a hearth a fire, the square's dry basin water, and every place warm lights", () => {
	const kinds = (name: string) => fantasy(name).overlaySlots.map((slot) => slot.kind);
	for (const name of ["headquarters", "common-room", "wing-large"]) expect(kinds(name)).toContain("fire");
	expect(kinds("square")).toContain("water");
	for (const name of PLACE_FILES) expect(kinds(name).filter((kind) => kind === "glow").length).toBeGreaterThan(3);
	for (const name of ["wing-small", "wing-large"]) expect(kinds(name)).toContain("banner");
});

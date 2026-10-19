import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeStrips, stripsFor } from "../web/game/layout.js";
import { findPath, gridFor, isOpen } from "../web/game/pathing.js";
import { PLACE_FILES, type PlaceData, type Point } from "../web/theme.js";

// Every theme pack's hand-traced place data, checked the way the avatar uses it: from every way in, it can walk to
// every spot and every door, and every overlay slot sits inside its painting. Each pack is checked on the place files
// it has so far, so a pack being traced is checked file by file as they land.
const themesDir = fileURLToPath(new URL("../themes/", import.meta.url));
const themes = readdirSync(themesDir).filter((theme) => existsSync(`${themesDir}${theme}/places`));
const placeFiles = (theme: string): string[] =>
	readdirSync(`${themesDir}${theme}/places`)
		.filter((file) => file.endsWith(".json"))
		.map((file) => file.slice(0, -".json".length))
		.sort();
const load = (theme: string, name: string): PlaceData =>
	JSON.parse(readFileSync(`${themesDir}${theme}/places/${name}.json`, "utf8"));
const fantasy = (name: string): PlaceData => load("fantasy", name);

/** Each place as drawn: the gallery with seven niches (two repeats of its painted section). */
const asDrawn = (name: string, place: PlaceData): [string, PlaceData] => {
	if (!place.niches) return [name, place];
	const strips = stripsFor(place.niches, 7);
	const composed = composeStrips(place, strips);
	// The wing doors stand in the niches; where one stands to use each door.
	const niches = strips.flatMap((strip, i) =>
		place
			.niches!.at.filter((x) => x >= strip.from && (x < strip.to || i === strips.length - 1))
			.map((x) => x - strip.from + strip.at),
	);
	const { door, standAt } = place.niches!;
	const doors = niches.map((x, i) => ({
		name: `wing ${i}`,
		rect: [x + door[0], door[1], door[2], door[3]] as [number, number, number, number],
		standAt: [x + standAt[0], standAt[1]] as Point,
		to: "wing",
	}));
	return [`${name} (7 wings)`, { ...composed, doors: [...composed.doors, ...doors] }];
};

const places: [string, PlaceData][] = themes.flatMap((theme) =>
	placeFiles(theme).map((name) => {
		const [label, place] = asDrawn(name, load(theme, name));
		return [`${theme}/${label}`, place] as [string, PlaceData];
	}),
);

it("finds every pack's place files", () => {
	expect(themes).toContain("fantasy");
	for (const name of PLACE_FILES) expect(placeFiles("fantasy")).toContain(name);
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

describe.each(themes)("the %s pack", (theme) => {
	const kinds = (name: string) => load(theme, name).overlaySlots.map((slot) => slot.kind);
	const has = (name: string) => placeFiles(theme).includes(name);

	it("hangs a banner in each wing and fills the square's dry basin", () => {
		for (const name of ["wing-small", "wing-large"]) if (has(name)) expect(kinds(name)).toContain("banner");
		if (has("square")) expect(kinds("square")).toContain("water");
	});

	it("leads every function place back to the square, and the square to each of them", () => {
		const functionPlaces = ["forge", "quest-office", "library", "inn", "rookery"].filter(has);
		for (const name of functionPlaces) expect(load(theme, name).doors.map((d) => d.to)).toContain("square");
		if (has("square")) {
			const to = load(theme, "square").doors.map((d) => d.to);
			for (const name of ["headquarters", ...functionPlaces]) expect(to).toContain(name);
		}
	});
});

it("gives the inn a hearth fire, its innkeeper behind the bar, beds whose sleepers climb in from open floor, and stairs", () => {
	const inn = fantasy("inn");
	expect(inn.overlaySlots.map((slot) => slot.kind)).toContain("fire");
	expect(inn.host?.look).toBe("innkeeper");
	const beds = inn.overlaySlots.filter((slot) => slot.kind === "bed");
	expect(beds.length).toBeGreaterThan(0);
	for (const bed of beds) {
		// Each bed's sleeper takes a spot beside it.
		const spot = inn.spots[bed.spot!];
		expect(spot, `bed at ${bed.at}`).toBeDefined();
		expect(Math.hypot(spot[0] - bed.at[0], spot[1] - (bed.at[1] - 1))).toBeLessThan(2.5);
	}
	expect(inn.doors.map((door) => door.to)).toEqual(expect.arrayContaining(["square", "rooms"]));
	expect(fantasy("square").entries).toHaveProperty("inn");
});

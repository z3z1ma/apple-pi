import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkThemePack } from "../src/backend/theme-packs.js";
import { describeProblems, type PlaceData, type ThemeManifest } from "../src/theme-pack.js";
import { findPath, gridFor } from "../web/game/pathing.js";

// A second exterior (ticket 09 of the alive pass): each pack paints one more place out of doors, joined to the square
// (the fantasy harbour lane, the tech office's shop street, the anime school's shopping street). It is a place every
// pack must have, reached by an exit from the square and left by a way back, and the square paints more spots so more
// townsfolk stand there.
const themesDir = fileURLToPath(new URL("../themes/", import.meta.url));
const packs = readdirSync(themesDir).filter((id) => existsSync(join(themesDir, id, "theme.json")));
const load = (id: string, name: string): PlaceData =>
	JSON.parse(readFileSync(join(themesDir, id, "places", `${name}.json`), "utf8"));
const manifest = (id: string): ThemeManifest => JSON.parse(readFileSync(join(themesDir, id, "theme.json"), "utf8"));

/** How many townsfolk spots each square painted before this ticket. */
const SQUARE_SPOTS_BEFORE = 10;

/** A painting's width in px, from its PNG header. */
const paintingWidth = (id: string, place: PlaceData) =>
	readFileSync(join(themesDir, id, "places", place.painting)).readUInt32BE(16);

const scratch = mkdtempSync(join(tmpdir(), "aw-street-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

it("fails the pack check for a pack without a street, or without a name for it", { timeout: 60_000 }, async () => {
	const dir = join(scratch, "fantasy");
	cpSync(join(themesDir, "fantasy"), dir, { recursive: true });
	unlinkSync(join(dir, "places/street.json"));
	const file = join(dir, "theme.json");
	const value = JSON.parse(readFileSync(file, "utf8"));
	delete value.labels.street;
	writeFileSync(file, JSON.stringify(value));
	const problems = describeProblems(await checkThemePack(dir));
	expect(problems).toContain("places/street.json: is missing");
	expect(problems.some((line) => line.includes("street") && line.startsWith("theme.json"))).toBe(true);
});

describe.each(packs)("%s", (id) => {
	const square = load(id, "square");
	const street = load(id, "street");
	const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.05;

	it("names its street", () => {
		expect(manifest(id).labels.street?.trim()).toBeTruthy();
	});

	it("leads from the square to the street by an exit, and back by a way to the square", () => {
		const exit = square.doors.find((door) => door.to === "street");
		expect(exit, "the square's exit to the street").toBeDefined();
		expect(square.entries.street, "where the avatar arrives in the square from the street").toBeDefined();
		const back = street.doors.find((door) => door.to === "square");
		expect(back, "the street's way back to the square").toBeDefined();
		expect(street.entries.square, "where the avatar arrives in the street from the square").toBeDefined();
		// Townsfolk and the ambient cast come and go by the way back.
		expect(street.enterBy).toBe(back!.name);
		// Coming in from the other place, the avatar can walk to the exit back.
		const there = findPath(gridFor(street), street.entries.square, [back!.standAt]);
		expect(there && near(there.goal, back!.standAt)).toBe(true);
		const here = findPath(gridFor(square), square.entries.street, [exit!.standAt]);
		expect(here && near(here.goal, exit!.standAt)).toBe(true);
	});

	it("paints its street on the same scale as its square, so people are the same size in both", () => {
		expect(street.cols / street.rows).toBeCloseTo(2, 1);
		expect(paintingWidth(id, street) / street.cols).toBeCloseTo(paintingWidth(id, square) / square.cols, 1);
	});

	it("stands more townsfolk in the square than before, and some in the street", () => {
		expect(square.spots.length).toBeGreaterThan(SQUARE_SPOTS_BEFORE);
		expect(street.spots.length).toBeGreaterThanOrEqual(6);
	});

	it("gives the street points of interest to stroll to, lamps that glow, and things to fidget with", () => {
		expect((street.interest ?? []).length).toBeGreaterThanOrEqual(4);
		expect(street.overlaySlots.filter((slot) => slot.kind === "glow").length).toBeGreaterThan(3);
		expect(street.overlaySlots.filter((slot) => slot.kind === "fidget").length).toBeGreaterThanOrEqual(2);
	});
});

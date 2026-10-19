import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkThemePack } from "../src/backend/theme-packs.js";
import { describeProblems, type Look } from "../src/theme-pack.js";
import { floorFidgets } from "../web/game/fidget-spots.js";
import { findPath, gridFor, isOpen } from "../web/game/pathing.js";
import type { PlaceData, Point } from "../web/theme.js";

// Life in the places (tickets 06 and 07): every look's idle sheet (eight standing poses) and each place's points of
// interest, where wanderers pause. The pack check holds every pack to both; a pack may leave either out, but what it
// has must be right.
const themesDir = fileURLToPath(new URL("../themes/", import.meta.url));
const packs = readdirSync(themesDir).filter((id) => existsSync(join(themesDir, id, "theme.json")));
const load = (id: string, name: string): PlaceData =>
	JSON.parse(readFileSync(join(themesDir, id, "places", `${name}.json`), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "aw-life-packs-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let copies = 0;
function brokenPack(fault: (dir: string) => void): string {
	const dir = join(scratch, String(++copies), "fantasy");
	cpSync(join(themesDir, "fantasy"), dir, { recursive: true });
	fault(dir);
	return dir;
}
const editJson = (file: string, change: (value: any) => void) => {
	const value = JSON.parse(readFileSync(file, "utf8"));
	change(value);
	writeFileSync(file, JSON.stringify(value));
};

/** Places where characters stand about and may wander. */
const LIVED_IN = ["square", "headquarters", "common-room", "wing-small", "wing-large"];

describe.each(packs)("%s", (id) => {
	const looks: Record<string, Look> = JSON.parse(readFileSync(join(themesDir, id, "characters", "looks.json"), "utf8"));

	it("gives every look an idle sheet", () => {
		for (const [name, look] of Object.entries(looks)) expect(look.idle, `${name}'s idle`).toBeDefined();
	});

	it.each(LIVED_IN)("names points of interest in its %s, clear of doors and of where others stand", (name) => {
		const place = load(id, name);
		const interest = place.interest ?? [];
		expect(interest.length, `${name} has points of interest`).toBeGreaterThanOrEqual(name === "square" ? 4 : 2);
		const grid = gridFor(place);
		const crowded = gridFor(place, [...place.spots, ...(place.host ? [place.host.at] : [])]);
		const from = Object.values(place.entries)[0];
		for (const point of interest) {
			expect(point.name.trim(), "a point of interest has a name").not.toBe("");
			expect(isOpen(grid, point.at), `${point.name} on open floor`).toBe(true);
			const keepClear: [string, Point, number][] = [
				...place.doors.map((door): [string, Point, number] => [`door ${door.name}`, door.standAt, 1]),
				...Object.entries(place.entries).map(([way, at]): [string, Point, number] => [`entry ${way}`, at, 1]),
				...place.spots.map((at, i): [string, Point, number] => [`spot ${i}`, at, 0.9]),
				...(place.host ? [["host", place.host.at, 0.9] as [string, Point, number]] : []),
				...(place.recruiter ? [["recruiter", place.recruiter.at, 0.9] as [string, Point, number]] : []),
				...floorFidgets(place).map((at): [string, Point, number] => ["a fidget on the floor", at, 1]),
			];
			for (const [what, at, least] of keepClear)
				expect(
					Math.hypot(at[0] - point.at[0], at[1] - point.at[1]),
					`${point.name} near ${what}`,
				).toBeGreaterThanOrEqual(least);
			// Reachable with everyone at their spots.
			const path = findPath(crowded, from, [point.at]);
			expect(path && Math.hypot(path.goal[0] - point.at[0], path.goal[1] - point.at[1]), point.name).toBeLessThan(0.05);
		}
	});
});

describe("the pack check", { timeout: 30_000 }, () => {
	it("checks an idle sheet's layout and baseline, and its file", async () => {
		const dir = brokenPack((d) => {
			editJson(join(d, "characters/looks.json"), (all) => {
				all.mage.idle.frame = [70, all.mage.idle.frame[1]];
				all.scout.idle.baseline -= 6;
				all.cleric.idle = { frame: "wide" };
			});
			rmSync(join(d, "characters/ranger-idle.png"));
		});
		const found = describeProblems(await checkThemePack(dir));
		const mage = JSON.parse(readFileSync(join(dir, "characters/mage-idle.json"), "utf8"));
		expect(found).toEqual(
			expect.arrayContaining([
				`characters/mage-idle.png: is ${mage.frameWidth * 8} x ${mage.frameHeight} px, but 8 idle frames of 70 x ${mage.frameHeight} (looks.json) make 560 x ${mage.frameHeight}`,
				"characters/looks.json: look cleric's idle needs a frame [w, h] and a baseline",
				"characters/ranger-idle.png: is missing (the idle sheet looks.json names)",
			]),
		);
		expect(found.find((line) => line.startsWith("characters/scout-idle.png: idle frames 0, 1"))).toMatch(
			/stand off the baseline/,
		);
	});

	it("passes a look without an idle sheet: idles are optional", async () => {
		const dir = brokenPack((d) =>
			editJson(join(d, "characters/looks.json"), (all) => {
				delete all.mage.idle;
			}),
		);
		expect(describeProblems(await checkThemePack(dir))).toEqual([]);
	});

	it("checks points of interest: named, inside the grid, on open floor, and off doors' stand points", async () => {
		const square = load("fantasy", "square");
		const door = square.doors[0].standAt;
		const blocked = square.blocked[0];
		const dir = brokenPack((d) =>
			editJson(join(d, "places/square.json"), (place) => {
				place.interest = [
					{ name: "", at: [10, 10] },
					{ name: "far", at: [99, 2] },
					{ name: "in a wall", at: [blocked[0] + blocked[2] / 2, blocked[1] + blocked[3] / 2] },
					{ name: "on the door", at: door },
					{ name: "pointless" },
				];
			}),
		);
		const found = describeProblems(await checkThemePack(dir));
		expect(found).toEqual(
			expect.arrayContaining([
				"places/square.json: point of interest 0 has no name",
				"places/square.json: point of interest far [99, 2] lies outside its grid",
				expect.stringMatching(/^places\/square.json: point of interest in a wall \[.*\] is not on open floor$/),
				`places/square.json: point of interest on the door [${door.join(", ")}] is within a tile of door ${square.doors[0].name}'s stand point`,
				"places/square.json: point of interest 4 has no place (at)",
			]),
		);
	});
});

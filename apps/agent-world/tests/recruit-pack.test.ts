import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkThemePack } from "../src/backend/theme-packs.js";
import { describeProblems } from "../src/theme-pack.js";
import { floorFidgets } from "../web/game/fidget-spots.js";
import { findPath, gridFor, isOpen } from "../web/game/pathing.js";
import type { PlaceData, Point } from "../web/theme.js";

// Recruiting in the places (ticket 10): the square's recruiter stands at a booth on open floor, in sight and out of
// everyone's way, and the headquarters' desk recruits workers; the pack check holds every pack to both, and to the
// theme's own words for them.
const themesDir = fileURLToPath(new URL("../themes/", import.meta.url));
const packs = readdirSync(themesDir).filter((id) => existsSync(join(themesDir, id, "theme.json")));
const load = (id: string, name: string): PlaceData =>
	JSON.parse(readFileSync(join(themesDir, id, "places", `${name}.json`), "utf8"));

describe.each(packs)("%s", (id) => {
	const square = load(id, "square");

	it("stands the recruiter on open floor, clear of where others stand and come in, and reachable from every way in", () => {
		const at = square.recruiter?.at as Point;
		expect(at, "square.json has a recruiter").toBeDefined();
		expect(isOpen(gridFor(square), at)).toBe(true);
		const keepClear = [
			...square.spots,
			...Object.values(square.entries),
			...square.doors.map((door) => door.standAt),
			...(square.host ? [square.host.at] : []),
			...floorFidgets(square),
		];
		for (const other of keepClear)
			expect(Math.hypot(at[0] - other[0], at[1] - other[1]), `recruiter near ${other}`).toBeGreaterThanOrEqual(1.2);
		// With everyone at their spots and the recruiter at its booth, the avatar still reaches it and every door.
		const crowded = gridFor(square, [...square.spots, at, ...(square.host ? [square.host.at] : [])]);
		for (const [way, from] of Object.entries(square.entries)) {
			const path = findPath(crowded, from, [
				[at[0], at[1] + 1],
				[at[0] - 1, at[1]],
				[at[0] + 1, at[1]],
			]);
			expect(path && Math.hypot(path.goal[0] - at[0], path.goal[1] - at[1]) <= 1.6, `${way} -> recruiter`).toBe(true);
			for (const door of square.doors) {
				const toDoor = findPath(crowded, from, door.standAt);
				expect(toDoor && Math.hypot(toDoor.goal[0] - door.standAt[0], toDoor.goal[1] - door.standAt[1]) < 0.05).toBe(
					true,
				);
			}
		}
	});

	it("keeps the recruiter in sight: no foreground piece is drawn over it", () => {
		const [x, y] = square.recruiter!.at;
		// A standing figure covers about 0.9 tiles across and two tiles up from its feet.
		for (const { rect, feet } of square.foreground ?? []) {
			const [rx, ry, rw, rh] = rect;
			const overlaps = x + 0.45 > rx && x - 0.45 < rx + rw && y > ry && y - 2 < ry + rh;
			expect(overlaps && y < feet, `foreground ${rect} covers the recruiter`).toBe(false);
		}
	});

	it("lets the headquarters' desk recruit a worker", () => {
		const desk = load(id, "headquarters").furniture?.find((piece) => piece.use === "recruit");
		expect(desk?.name).toBeTruthy();
	});
});

const scratch = mkdtempSync(join(tmpdir(), "aw-recruit-packs-"));
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

describe("the pack check", { timeout: 30_000 }, () => {
	it("wants the recruiter's name and the recruiting lines in the theme's own words", async () => {
		const dir = brokenPack((d) =>
			editJson(join(d, "theme.json"), (theme) => {
				delete theme.labels.recruiter;
				delete theme.text["recruit-worker"];
				theme.text["recruit-send"] = " ";
			}),
		);
		expect(describeProblems(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"theme.json: has no label for recruiter",
				"theme.json: has no line for recruit-worker, recruit-send",
			]),
		);
	});

	it("wants a square with its recruiter on open floor, and a headquarters with a desk that recruits", async () => {
		const dir = brokenPack((d) => {
			editJson(join(d, "places/headquarters.json"), (place) => {
				place.furniture = (place.furniture ?? []).filter((piece: { use: string }) => piece.use !== "recruit");
			});
		});
		const missing = brokenPack((d) => editJson(join(d, "places/square.json"), (place) => delete place.recruiter));
		const walled = brokenPack((d) =>
			editJson(join(d, "places/square.json"), (place) => {
				place.recruiter = { at: [22, 13.5] };
			}),
		);
		expect(describeProblems(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"places/headquarters.json: has no furniture whose use is recruit; the coordinator's desk recruits workers there",
			]),
		);
		expect(describeProblems(await checkThemePack(missing))).toEqual(
			expect.arrayContaining([
				"places/square.json: has no recruiter; the square's recruiter recruits independent agents at its booth",
			]),
		);
		expect(describeProblems(await checkThemePack(walled))).toEqual(
			expect.arrayContaining(["places/square.json: its recruiter [22, 13.5] is not on open floor"]),
		);
	});

	it("dresses the recruiter in a look the pack has, made for its role", async () => {
		const unknown = brokenPack((d) =>
			editJson(join(d, "places/square.json"), (place) => {
				place.recruiter.look = "no-such-look";
			}),
		);
		const agent = brokenPack((d) =>
			editJson(join(d, "places/square.json"), (place) => {
				place.recruiter.look = "mage";
			}),
		);
		expect(describeProblems(await checkThemePack(unknown))).toEqual(
			expect.arrayContaining(["characters/looks.json: has no look no-such-look, which a place's host wears"]),
		);
		expect(describeProblems(await checkThemePack(agent))).toEqual(
			expect.arrayContaining(["places/square.json: its recruiter wears mage, which is not a recruiter look"]),
		);
	});
});

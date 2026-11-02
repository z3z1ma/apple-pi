import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkThemePack } from "../src/backend/theme-packs.js";
import { describeProblems, PLACE_FILES } from "../src/theme-pack.js";
import type { PlaceData } from "../web/theme.js";

// The aliveness pass (ticket 11 of the alive pass): every place in every pack has ambient motion that is not a
// character (`atmosphere`: dust motes in the light, falling leaves or petals, birds or a plane crossing the sky, steam,
// sparks, blinking lights, screens, glints on water, lit windows at night). The pack check holds what a pack names to
// the format; this test holds the built-in packs to having it everywhere.
const themesDir = fileURLToPath(new URL("../themes/", import.meta.url));
const packs = readdirSync(themesDir).filter((id) => existsSync(join(themesDir, id, "theme.json")));
const load = (id: string, name: string): PlaceData =>
	JSON.parse(readFileSync(join(themesDir, id, "places", `${name}.json`), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "aw-atmosphere-packs-"));
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

/** What moves in the air of each kind of place, besides the characters. */
const MOVING = ["motes", "fall", "sky", "steam", "sparks", "blink", "screens", "shimmer"];
/** What falls out of doors in each pack: autumn leaves in fantasy, cherry petals in the anime school. */
const FALLING: Record<string, string | undefined> = { fantasy: "leaves", "anime-school": "petals" };

describe.each(packs)("%s", (id) => {
	it.each(PLACE_FILES)("has ambient motion in its %s", (name) => {
		const atmosphere = load(id, name).atmosphere ?? [];
		expect(
			atmosphere.filter((effect) => MOVING.includes(effect.kind)).length,
			`${name}'s moving atmosphere`,
		).toBeGreaterThan(0);
	});

	it.each(["square", "street"])("crosses its %s's sky, lights its windows at night, and lets things fall", (name) => {
		const atmosphere = load(id, name).atmosphere ?? [];
		expect(atmosphere.some((effect) => effect.kind === "sky")).toBe(true);
		expect(atmosphere.find((effect) => effect.kind === "lights")?.rects?.length).toBeGreaterThan(0);
		const falling = FALLING[id];
		if (falling) expect(atmosphere.some((effect) => effect.kind === "fall" && effect.what === falling)).toBe(true);
	});
});

describe("the pack check", { timeout: 30_000 }, () => {
	it("checks a place's atmosphere: its kind, where it is, and what it names", async () => {
		const dir = brokenPack((d) =>
			editJson(join(d, "places/inn.json"), (place) => {
				place.atmosphere = [
					{ kind: "fog" },
					{ kind: "motes", rect: [20, 10, 9, 2] },
					{ kind: "steam" },
					{ kind: "steam", at: [30, 2] },
					{ kind: "fall", what: "snow" },
					{ kind: "sky", what: "dragons" },
					{ kind: "screens" },
					{ kind: "motes", count: -3 },
					{ kind: "blink", rect: [1, 1, 2, 2], colors: ["green"] },
				];
			}),
		);
		expect(describeProblems(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				'places/inn.json: atmosphere 0 is "fog"; kind is one of motes, fall, sky, steam, sparks, blink, screens, shimmer, lights',
				"places/inn.json: atmosphere 1 (motes) [20, 10, 9, 2] lies outside its grid",
				"places/inn.json: atmosphere 2 (steam) has no place (at)",
				"places/inn.json: atmosphere 3 (steam) at [30, 2] lies outside its grid",
				'places/inn.json: atmosphere 4 (fall) names "snow"; what is one of leaves, petals',
				'places/inn.json: atmosphere 5 (sky) names "dragons"; what is one of birds, plane',
				"places/inn.json: atmosphere 6 (screens) has no rects [[x, y, w, h], ...]",
				"places/inn.json: atmosphere 7 (motes) has a count that is not a positive number",
				'places/inn.json: atmosphere 8 (blink) has colours that are not #rrggbb: "green"',
			]),
		);
	});

	it("passes a place without atmosphere: it is optional", async () => {
		const dir = brokenPack((d) =>
			editJson(join(d, "places/inn.json"), (place) => {
				delete place.atmosphere;
			}),
		);
		expect(describeProblems(await checkThemePack(dir))).toEqual([]);
	});
});

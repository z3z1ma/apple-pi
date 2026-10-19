import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkThemePack } from "../src/backend/theme-packs.js";
import {
	describeProblems,
	type OverlaySlot,
	type PlaceData,
	petArt,
	pngSize,
	slotStyle,
	type ThemeManifest,
} from "../src/theme-pack.js";
import { fidgetScale, fidgetSlots } from "../web/game/fidget-spots.js";
import { PERSON_TILES } from "../web/game/walker.js";

// Pets varied and to scale (alive pass, ticket 03), over the real packs as the scene sizes them: fewer pets, each its
// own look (no place holds two, no two places share one), and each drawn to its kind's size beside a standing
// character, whatever size its art was painted. The pack check holds every pack to the first part.
const appDir = fileURLToPath(new URL("..", import.meta.url));
const themesDir = join(appDir, "themes");
const THEMES = ["fantasy", "tech-office", "anime-school"] as const;
const read = <T>(path: string): T => JSON.parse(readFileSync(join(themesDir, path), "utf8"));

/**
 * How tall each pet sits beside a standing character, by what it is: a cat about a third, a dog about half, a small
 * animal or bird less than a cat, a parrot on its perch stand about a cat and a half.
 */
const SIZES = {
	cat: [0.28, 0.38],
	dog: [0.4, 0.56],
	small: [0.12, 0.3],
	perched: [0.36, 0.5],
} as const;
const ANIMAL: Record<string, Record<string, keyof typeof SIZES>> = {
	fantasy: { "": "cat", "cat-black": "cat", hound: "dog", owl: "small", rabbit: "small" },
	"tech-office": { "": "dog", "cat-grey": "cat", parrot: "perched", hamster: "small", hedgehog: "small" },
	"anime-school": { "": "cat", shiba: "dog", "rabbit-white": "small", crow: "small", tanuki: "cat" },
};

const placesOf = (theme: string) =>
	readdirSync(join(themesDir, theme, "places"))
		.filter((file) => file.endsWith(".json"))
		.map((file) => ({ name: file.slice(0, -5), place: read<PlaceData>(`${theme}/places/${file}`) }));
const petsOf = (place: PlaceData) =>
	fidgetSlots(place).filter((slot) => slot.fidget === "pet" || slot.fidget === "sleeper");

describe.each(THEMES)("the %s pack's pets", (theme) => {
	const manifest = read<ThemeManifest>(`${theme}/theme.json`);
	const pet = manifest.fidgets!.pet!;
	const placed = placesOf(theme).flatMap(({ name, place }) => petsOf(place).map((slot) => ({ name, slot })));

	it("are one to a place, each a look of its own, and every look the pack draws is somewhere", () => {
		for (const { name, place } of placesOf(theme)) expect(petsOf(place).length, name).toBeLessThanOrEqual(1);
		const looks = placed.map(({ slot }) => (slot.fidget === "sleeper" ? "sleeper" : (slot.look ?? "")));
		expect(new Set(looks).size, looks.join(", ")).toBe(looks.length);
		expect(looks.sort()).toEqual(["", ...Object.keys(pet.looks ?? {})].sort());
		// At most one pet per pack lies curled up asleep (a sleeper, or a pet resting on its sleep frame).
		expect(placed.filter(({ slot }) => slot.asleep || slot.fidget === "sleeper").length).toBeLessThanOrEqual(1);
	});

	it("each sit at its kind's height beside a standing character, drawn at one pixel size across their frames", () => {
		for (const { name, slot } of placed) {
			const style = slotStyle(pet, slot);
			const [sit] = petArt(slot.look);
			const size = pngSize(readFileSync(join(themesDir, theme, "overlays", `${sit}.png`)))!;
			const tall = fidgetScale("pet", style, slot, size, PERSON_TILES) * size.height;
			const animal = ANIMAL[theme][slot.look ?? ""];
			const [low, high] = SIZES[animal];
			const share = tall / PERSON_TILES;
			expect(
				share,
				`${style.name} in ${name} (a ${animal}): ${share.toFixed(2)} of a character`,
			).toBeGreaterThanOrEqual(low);
			expect(share, `${style.name} in ${name} (a ${animal})`).toBeLessThanOrEqual(high);
		}
		// Smaller kinds are drawn smaller than the pack's cats and dogs.
		const heights = Object.fromEntries(
			placed.map(({ slot }) => [slot.look ?? "", slotStyle(pet, slot).height ?? 0] as const),
		);
		const of = (animal: keyof typeof SIZES) =>
			Object.entries(ANIMAL[theme])
				.filter(([, a]) => a === animal)
				.map(([look]) => heights[look]);
		const small = of("small");
		const big = [...of("cat"), ...of("dog")];
		expect(Math.max(...small)).toBeLessThan(Math.min(...big));
	});
});

describe("the pack check holds a pack to its pets", { timeout: 30_000 }, () => {
	const scratch = mkdtempSync(join(tmpdir(), "aw-pets-"));
	afterAll(() => rmSync(scratch, { recursive: true, force: true }));
	let copies = 0;
	const broken = (fault: (dir: string) => void) => {
		const dir = join(scratch, String(++copies), "fantasy");
		cpSync(join(themesDir, "fantasy"), dir, { recursive: true });
		fault(dir);
		return dir;
	};
	const edit = (file: string, change: (value: any) => void) => {
		const value = JSON.parse(readFileSync(file, "utf8"));
		change(value);
		writeFileSync(file, JSON.stringify(value));
	};
	const add = (dir: string, place: string, ...slots: OverlaySlot[]) =>
		edit(join(dir, "places", `${place}.json`), (data) => data.overlaySlots.push(...slots));

	it("passes the real packs", async () => {
		for (const theme of THEMES) expect(describeProblems(await checkThemePack(join(themesDir, theme)))).toEqual([]);
	});

	it("names a place with two pets, a look two places share, an unknown look, and a sleeper who cannot sleep", async () => {
		const dir = broken((d) => {
			add(d, "inn", { kind: "fidget", fidget: "sleeper", at: [12, 8] });
			add(d, "quest-office", { kind: "fidget", fidget: "pet", look: "hound", at: [10, 10] });
			add(d, "headquarters", { kind: "fidget", fidget: "pet", look: "dragon", at: [15, 10] });
			add(d, "gallery", { kind: "fidget", fidget: "pet", asleep: true, at: [10, 12] });
			add(d, "common-room", { kind: "fidget", fidget: "bell", look: "hound", at: [10, 8] });
		});
		expect(describeProblems(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"places/inn.json: holds more than one pet (a sleeper counts)",
				"places/quest-office.json: holds pet look hound, as places/forge.json does: no two places share a pet",
				'places/headquarters.json: a pet at [15, 10] wears look "dragon", which fidgets.pet.looks does not name',
				"places/inn.json: holds the pet's own look, as places/gallery.json does: no two places share a pet",
				"places/gallery.json: a pet at [10, 12] is asleep, but its look has no sleep frame",
				"places/common-room.json: a fidget slot at [10, 8] gives a look or asleep, which only a pet has",
			]),
		);
	});

	it("names a look's missing sprite, a look without a name, and heights and frames that make no pet", async () => {
		const dir = broken((d) => {
			rmSync(join(d, "overlays/pet-owl-2.png"));
			edit(join(d, "theme.json"), (theme) => {
				theme.fidgets.pet.height = 3;
				theme.fidgets.pet.looks.rabbit.frames = ["sit", "sit", "play", "sleep"];
				theme.fidgets.pet.looks.hound.verbs = { fetch: "Fetch" };
				delete theme.fidgets.pet.looks.owl.name;
			});
		});
		expect(describeProblems(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"overlays/pet-owl-2.png: is missing",
				"theme.json: fidgets.pet.height is not a share of a standing character's height (above 0, at most 1.2)",
				"theme.json: fidgets.pet.looks.rabbit.frames is not four different frames of sit, petted, play, stretch, sleep, with sit, petted, and play",
				"theme.json: fidgets.pet.looks.hound.verbs names a verb for each of pet, play only",
				"theme.json: fidgets.pet.looks.owl has no name",
			]),
		);
	});
});

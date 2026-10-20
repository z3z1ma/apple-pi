import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkThemePack } from "../src/backend/theme-packs.js";
import {
	type AmbientMember,
	type AmbientPlacement,
	describeProblems,
	type Look,
	PLACE_FILES,
	type ThemeManifest,
} from "../src/theme-pack.js";
import { Patter, REACT_AFTER, STREAK_MS } from "../web/game/ambient.js";
import { floorFidgets } from "../web/game/fidget-spots.js";
import { findPath, gridFor, isOpen } from "../web/game/pathing.js";
import type { PlaceData, Point } from "../web/theme.js";

// Ambient NPCs (ticket 08): each pack's cast of characters who are there for fun, defined in its manifest (`ambient`)
// and placed in its places' data (`ambient`). The pack check holds every pack to the cast's shape and placement; the
// real packs each cast four, one place each, in the square and fitting interiors; and a cast member's lines rotate,
// with its reaction when it is clicked several times in a row.
const themesDir = fileURLToPath(new URL("../themes/", import.meta.url));
const packs = readdirSync(themesDir).filter((id) => existsSync(join(themesDir, id, "theme.json")));
const placeFiles = (id: string) =>
	readdirSync(join(themesDir, id, "places"))
		.filter((file) => file.endsWith(".json"))
		.map((file) => file.slice(0, -5));
const load = (id: string, name: string): PlaceData =>
	JSON.parse(readFileSync(join(themesDir, id, "places", `${name}.json`), "utf8"));
const manifestOf = (id: string): ThemeManifest => JSON.parse(readFileSync(join(themesDir, id, "theme.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "aw-ambient-packs-"));
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
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Where each pack's cast is expected: the inn's own character, and one posted by the headquarters' door. */
const FITTING: Record<string, { inn: string; door?: string }> = {
	fantasy: { inn: "bard", door: "guard" },
	"tech-office": { inn: "barista" },
	"anime-school": { inn: "lunchlady", door: "monitor" },
};

/** Looks nobody of the headquarters crew may wear: the agents', the coordinator's, the avatars', and every host's. */
const CREW_LOOK_ROLES = ["townsfolk", "ambient"];
/** Where the crew stands: the rooms the world shows once per coordinator. */
const CREW_ROOMS: Record<string, [least: number, most: number]> = { headquarters: [3, 4], "common-room": [1, 2] };
/** How far a point is from a rect [x, y, w, h], in tiles. */
const fromRect = ([x, y]: Point, [rx, ry, rw, rh]: number[]) =>
	Math.hypot(Math.max(rx - x, 0, x - (rx + rw)), Math.max(ry - y, 0, y - (ry + rh)));

describe.each(packs)("%s", (id) => {
	const looks: Record<string, Look> = JSON.parse(readFileSync(join(themesDir, id, "characters", "looks.json"), "utf8"));
	const everyone = manifestOf(id).ambient ?? {};
	// The town's cast, one place each; the headquarters crew (`crew`) staffs every coordinator's headquarters.
	const cast = Object.fromEntries(Object.entries(everyone).filter(([, member]) => !member.crew));
	const crew = Object.fromEntries(Object.entries(everyone).filter(([, member]) => member.crew));
	const placed = placeFiles(id).flatMap((name) =>
		(load(id, name).ambient ?? []).map((entry) => ({ place: name, entry })),
	);

	it("casts four ambient characters, one for each ambient look, each with lines and a reaction", () => {
		const ambientLooks = Object.entries(looks)
			.filter(([, look]) => look.role === "ambient")
			.map(([name]) => name)
			.sort();
		expect(Object.keys(cast)).toHaveLength(4);
		expect(
			Object.values(cast)
				.map((member) => member.look)
				.sort(),
		).toEqual(ambientLooks);
		for (const [name, member] of Object.entries(cast)) {
			expect(member.lines.length, `${name}'s lines`).toBeGreaterThanOrEqual(4);
			expect(member.reactions.length, `${name}'s reactions`).toBeGreaterThanOrEqual(2);
			expect(member.barks?.length ?? 0, `${name}'s barks`).toBeGreaterThanOrEqual(2);
			// Lines read in the small dialogue box in a few seconds.
			for (const line of [...member.lines, ...member.reactions, ...(member.barks ?? [])])
				expect(line.length, line).toBeLessThanOrEqual(120);
			for (const bark of member.barks ?? []) expect(bark.length, bark).toBeLessThanOrEqual(46);
		}
	});

	it("places each cast member in one place: the square and fitting interiors", () => {
		const where = new Map<string, string[]>();
		for (const { place, entry } of placed) where.set(entry.cast, [...(where.get(entry.cast) ?? []), place]);
		for (const name of Object.keys(everyone)) expect(where.get(name), `${name} stands somewhere once`).toHaveLength(1);
		expect(placed.filter(({ place }) => place === "square").length).toBeGreaterThanOrEqual(2);
		const fitting = FITTING[id];
		if (!fitting) return;
		expect(where.get(fitting.inn)).toEqual(["inn"]);
		if (fitting.door) {
			const square = load(id, "square");
			const door = square.doors.find((d) => d.to === "headquarters")!;
			const home = placed.find(({ entry }) => entry.cast === fitting.door)!;
			expect(home.place).toBe("square");
			expect(dist(home.entry.at, door.standAt)).toBeLessThan(3.5);
		}
	});

	it("stands each one clear of fidgets on the floor, where the avatar can walk up to talk", () => {
		for (const { place: name, entry } of placed) {
			const place = load(id, name);
			for (const at of floorFidgets(place))
				expect(dist(at, entry.at), `${entry.cast} near a fidget in the ${name}`).toBeGreaterThanOrEqual(1);
			const others = (place.ambient ?? []).filter((e) => e !== entry).map((e) => e.at);
			const crowded = gridFor(place, [
				...place.spots,
				...(place.host ? [place.host.at] : []),
				...(place.recruiter ? [place.recruiter.at] : []),
				...others,
				entry.at,
				...floorFidgets(place),
			]);
			// Beside it or a little in front, as the scene's `approach` stands.
			const stands: Point[] = [
				[-1.1, 0.05],
				[1.1, 0.05],
				[-1, 0.8],
				[1, 0.8],
				[0, 2.1],
				[0, -0.9],
			].map(([dx, dy]) => [entry.at[0] + dx, entry.at[1] + dy]);
			const from = place.entries.start ?? Object.values(place.entries)[0];
			const path = findPath(crowded, from, stands);
			const reached = path ? Math.min(...stands.map((stand) => dist(stand, path.goal))) : Number.POSITIVE_INFINITY;
			expect(reached, `the avatar reaches ${entry.cast} in the ${name}`).toBeLessThan(0.35);
		}
	});

	it("staffs every headquarters: a crew of three or four in the hall and one or two in the common room", () => {
		const worn = new Map(Object.entries(cast).map(([name, member]) => [member.look, name]));
		for (const [room, [least, most]] of Object.entries(CREW_ROOMS)) {
			const here = load(id, room).ambient ?? [];
			expect(here.length, `the crew in the ${room}`).toBeGreaterThanOrEqual(least);
			expect(here.length, `the crew in the ${room}`).toBeLessThanOrEqual(most);
			for (const entry of here) expect(crew[entry.cast], `${entry.cast} in the ${room} is crew`).toBeDefined();
			// Each wears its own look here: a townsperson's (or another look made for nobody's work), never one the town's
			// cast wears, an agent's, the coordinator's, the avatar's, or a host's.
			const theirs = here.map((entry) => crew[entry.cast].look);
			expect(new Set(theirs).size, `looks in the ${room}`).toBe(theirs.length);
			for (const look of theirs) {
				expect(CREW_LOOK_ROLES, `${look}'s role`).toContain(looks[look]?.role);
				expect(worn.get(look), `${look} is worn by the town's cast`).toBeUndefined();
			}
		}
		for (const name of Object.keys(crew))
			expect(
				placed.find(({ entry }) => entry.cast === name)?.place,
				`${name} stands in the headquarters or its common room`,
			).toMatch(/^(headquarters|common-room)$/);
		for (const [name, member] of Object.entries(crew)) {
			expect(member.lines.length, `${name}'s lines`).toBeGreaterThanOrEqual(4);
			expect(member.reactions.length, `${name}'s reactions`).toBeGreaterThanOrEqual(2);
			expect(member.barks?.length ?? 0, `${name}'s barks`).toBeGreaterThanOrEqual(2);
			for (const line of [...member.lines, ...member.reactions, ...(member.barks ?? [])])
				expect(line.length, line).toBeLessThanOrEqual(120);
			for (const bark of member.barks ?? []) expect(bark.length, bark).toBeLessThanOrEqual(46);
		}
	});

	it("keeps the crew off the coordinator's desk, and out of everyone's way to every door, spot, and the desk", () => {
		for (const room of Object.keys(CREW_ROOMS)) {
			const place = load(id, room);
			const homes = (place.ambient ?? []).map((entry) => entry.at);
			const desk = place.furniture?.find((piece) => piece.use === "recruit");
			for (const at of homes) if (desk) expect(fromRect(at, desk.rect), `${at} by the desk`).toBeGreaterThanOrEqual(2);
			// With the crew at home, everyone at their spots: every door, every spot, and the desk can still be reached.
			const grid = gridFor(place, [...place.spots, ...homes, ...floorFidgets(place)]);
			const goals: [string, Point[]][] = [
				...place.doors.map((door): [string, Point[]] => [door.name, [door.standAt]]),
				...place.spots.map((at, i): [string, Point[]] => [
					`spot ${i}`,
					[
						[at[0] - 1.1, at[1]],
						[at[0] + 1.1, at[1]],
						[at[0], at[1] + 1.1],
					],
				]),
				...(desk
					? [["the desk", [[desk.rect[0] + desk.rect[2] / 2, desk.rect[1] + desk.rect[3] + 0.6]]] as [string, Point[]]]
					: []),
			];
			for (const [from, start] of Object.entries(place.entries))
				for (const [what, stands] of goals) {
					const path = findPath(grid, start, stands);
					const reached = path ? Math.min(...stands.map((s) => dist(s, path.goal))) : Number.POSITIVE_INFINITY;
					expect(reached, `from ${from} to ${what} in the ${room}`).toBeLessThan(0.75);
				}
		}
	});

	it("passes the pack check", async () => {
		expect(describeProblems(await checkThemePack(join(themesDir, id)))).toEqual([]);
	});
});

describe("the pack check", { timeout: 30_000 }, () => {
	it("checks the cast in theme.json: names, lines, reactions, and ambient looks", async () => {
		const dir = brokenPack((d) => {
			editJson(join(d, "theme.json"), (theme) => {
				const bard: AmbientMember = theme.ambient.bard;
				theme.ambient.bard = { ...bard, lines: ["Only one."], reactions: [] };
				theme.ambient.guard.look = "mage";
				theme.ambient.baker.look = "nobody";
				theme.ambient.tourist.gesture = "cartwheel";
				theme.ambient.tourist.barks = "hello";
				theme.ambient["Bad Name"] = { name: "", lines: [] };
			});
		});
		const found = describeProblems(await checkThemePack(dir));
		expect(found).toEqual(
			expect.arrayContaining([
				"theme.json: ambient.bard has fewer than 3 lines to say when talked to",
				"theme.json: ambient.bard has no reaction to say when clicked again and again",
				"theme.json: ambient.guard wears mage, which is not an ambient look",
				"theme.json: ambient.baker wears nobody, which looks.json does not name",
				expect.stringMatching(/^theme.json: ambient.tourist.gesture is not one of look-around, /),
				"theme.json: ambient.tourist.barks is not a list of lines",
				"theme.json: ambient.Bad Name is not a cast name (lowercase words joined by -)",
				"theme.json: ambient.Bad Name has no name",
				"theme.json: ambient.Bad Name stands in no place",
			]),
		);
	});

	it("checks where the cast stands: a member it names, on open floor, clear of doors and of others, once", async () => {
		const square = load("fantasy", "square");
		const door = square.doors[0];
		const blocked = square.blocked[0];
		const placedIn = (name: string) =>
			PLACE_FILES.find((file) => (load("fantasy", file).ambient ?? []).some((e) => e.cast === name))!;
		const bardIn = placedIn("bard");
		const dir = brokenPack((d) =>
			editJson(join(d, "places/square.json"), (place) => {
				const extra: Partial<AmbientPlacement>[] = [
					{ cast: "stranger", at: [22, 18] },
					{ cast: "bard", at: [blocked[0] + blocked[2] / 2, blocked[1] + blocked[3] / 2] },
					{ cast: "tourist", at: door.standAt },
					{ cast: "baker", at: square.spots[0], face: "sideways" as never },
					{ at: [3, 3] },
				];
				place.ambient = extra;
			}),
		);
		const found = describeProblems(await checkThemePack(dir));
		expect(found).toEqual(
			expect.arrayContaining([
				"places/square.json: ambient stranger stands here, but theme.json's ambient does not name it",
				expect.stringMatching(/^places\/square.json: ambient bard \[.*\] is not on open floor$/),
				`places/square.json: ambient tourist [${door.standAt.join(", ")}] is within a tile of door ${door.name}'s stand point`,
				`places/square.json: ambient baker [${square.spots[0].join(", ")}] is within 0.9 tiles of spot 0`,
				`places/square.json: ambient baker [${square.spots[0].join(", ")}] faces "sideways", not up, down, left, or right`,
				"places/square.json: ambient 4 names no cast member",
				...(bardIn === "square"
					? []
					: [`places/${bardIn}.json: ambient bard stands here and in places/square.json: one person, one place`]),
			]),
		);
	});

	it("keeps the cast out of rooms that repeat: one person, one place", async () => {
		const dir = brokenPack((d) =>
			editJson(join(d, "places/common-room.json"), (place) => {
				place.ambient = [{ cast: "bard", at: place.spots[0] }];
			}),
		);
		expect(describeProblems(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"places/common-room.json: ambient bard stands in a room the world shows once per coordinator or wing",
			]),
		);
	});

	it("lets marked crew staff the headquarters and its common room, in townsfolk looks, one look per person there", async () => {
		const steward = (look: string, extra: Partial<AmbientMember> = {}): AmbientMember => ({
			name: `Steward in ${look}`,
			look,
			examine: "A steward.",
			lines: ["one", "two", "three"],
			reactions: ["oi"],
			crew: true,
			...extra,
		});
		const hall = load("fantasy", "headquarters");
		const room = load("fantasy", "common-room");
		// Open floor clear of everything the check keeps them from, found from the place's own data.
		const free = (place: PlaceData, n: number): Point[] => {
			const grid = gridFor(place);
			const taken: Point[] = [
				...place.spots,
				...Object.values(place.entries),
				...place.doors.map((d) => d.standAt),
				...(place.interest ?? []).map((p) => p.at),
				...(place.ambient ?? []).map((e) => e.at),
				...(place.host ? [place.host.at] : []),
				...(place.recruiter ? [place.recruiter.at] : []),
			];
			const found: Point[] = [];
			for (let y = 1; y < place.rows && found.length < n; y += 0.5)
				for (let x = 1; x < place.cols && found.length < n; x += 0.5) {
					const at: Point = [x, y];
					if (isOpen(grid, at) && [...taken, ...found].every((t) => dist(t, at) >= 1.5)) found.push(at);
				}
			return found;
		};
		const [h1, h2, h3] = free(hall, 3);
		const [r1] = free(room, 1);
		const [s1] = free(load("fantasy", "square"), 1);
		const good = brokenPack((d) => {
			editJson(join(d, "theme.json"), (theme) => {
				theme.ambient["steward-a"] = steward("townsfolk-1");
				theme.ambient["steward-b"] = steward("townsfolk-2");
				theme.ambient["steward-c"] = steward("townsfolk-1");
			});
			editJson(join(d, "places/headquarters.json"), (place) => {
				place.ambient = [
					{ cast: "steward-a", at: h1 },
					{ cast: "steward-b", at: h2 },
				];
			});
			// One look per person in a place: the common room may wear a look the hall wears.
			editJson(join(d, "places/common-room.json"), (place) => {
				place.ambient = [{ cast: "steward-c", at: r1 }];
			});
		});
		const crewOnly = (found: string[]) => found.filter((line) => /steward|crew/.test(line));
		expect(crewOnly(describeProblems(await checkThemePack(good)))).toEqual([]);

		const bad = brokenPack((d) => {
			editJson(join(d, "theme.json"), (theme) => {
				theme.ambient["steward-a"] = steward("townsfolk-1");
				theme.ambient["steward-b"] = steward("townsfolk-1");
				theme.ambient["steward-c"] = steward("mage");
				theme.ambient["steward-d"] = steward("ambient-bard");
				theme.ambient["steward-e"] = steward("townsfolk-3");
				theme.ambient["steward-f"] = steward("townsfolk-4", { crew: "yes" as never });
			});
			editJson(join(d, "places/headquarters.json"), (place) => {
				place.ambient = [
					{ cast: "steward-a", at: h1 },
					{ cast: "steward-b", at: h2 },
					{ cast: "steward-c", at: h3 },
				];
			});
			editJson(join(d, "places/common-room.json"), (place) => {
				place.ambient = [
					{ cast: "steward-d", at: r1 },
					{ cast: "steward-f", at: [r1[0], r1[1] + 1.5] },
				];
			});
			editJson(join(d, "places/square.json"), (place) => {
				place.ambient = [...place.ambient, { cast: "steward-e", at: s1 }];
			});
		});
		expect(describeProblems(await checkThemePack(bad))).toEqual(
			expect.arrayContaining([
				"places/headquarters.json: ambient steward-b wears townsfolk-1, as steward-a here does: one look per person in a place",
				"theme.json: ambient.steward-c wears mage, which is not a townsfolk or ambient look",
				"theme.json: ambient.steward-d wears ambient-bard, which ambient.bard wears too",
				"places/square.json: ambient steward-e is headquarters crew, who stand only in the headquarters or its common room",
				"theme.json: ambient.steward-f.crew is not true or false",
				// Unmarked, it may not stand in a room that repeats.
				"places/common-room.json: ambient steward-f stands in a room the world shows once per coordinator or wing",
			]),
		);
	});

	it("passes a pack with no cast: ambient characters are optional", async () => {
		const dir = brokenPack((d) => {
			editJson(join(d, "theme.json"), (theme) => {
				delete theme.ambient;
			});
			for (const file of PLACE_FILES)
				editJson(join(d, "places", `${file}.json`), (place) => {
					delete place.ambient;
				});
		});
		expect(describeProblems(await checkThemePack(dir))).toEqual([]);
	});
});

describe("what a cast member says", () => {
	const member: AmbientMember = {
		name: "Pip",
		look: "ambient-bard",
		examine: "A bard.",
		lines: ["one", "two", "three"],
		reactions: ["easy!", "again?"],
	};

	it("says its lines in turn, round and round, and remembers where it was", () => {
		const memory = new Map();
		const patter = new Patter("fantasy:bard", member, memory);
		const said: string[] = [];
		for (let i = 0; i < 4; i++) {
			patter.click(i * 10_000);
			said.push(patter.next().line);
		}
		expect(said).toEqual(["one", "two", "three", "one"]);
		// Met again (another visit), it goes on from where it was.
		const again = new Patter("fantasy:bard", member, memory);
		again.click(100_000);
		expect(again.next()).toEqual({ line: "two", reaction: false });
	});

	it("reacts when clicked several times in a row, then talks again after a pause", () => {
		const patter = new Patter("fantasy:bard", member, new Map());
		const results = [];
		let now = 0;
		for (let i = 0; i < REACT_AFTER + 1; i++) {
			patter.click(now);
			results.push(patter.next());
			now += STREAK_MS / 2;
		}
		expect(results.map((r) => r.reaction)).toEqual([
			...Array.from({ length: REACT_AFTER - 1 }, () => false),
			true,
			true,
		]);
		expect(results.slice(-2).map((r) => r.line)).toEqual(["easy!", "again?"]);
		// The talk lines went on only for the talks, not the reactions.
		patter.click(now + STREAK_MS * 3);
		expect(patter.next()).toEqual({ line: member.lines[REACT_AFTER - 1], reaction: false });
	});

	it("counts clicks made while the avatar was still walking up", () => {
		const patter = new Patter("fantasy:bard", member, new Map());
		for (let i = 0; i < REACT_AFTER; i++) patter.click(i * 300);
		// Only the last click's walk arrives: it reacts.
		expect(patter.next().reaction).toBe(true);
	});
});

import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { checkThemePack, listThemes, NEUTRAL_BACKDROP, themeBackdrop } from "../src/backend/theme-packs.js";
import { describeProblems, type PackProblem } from "../src/theme-pack.js";

// Seam 1 for the pack check: the backend module (and its CLI) over the real packs, and over copies of the fantasy
// pack with one fault each, as a theme author would make them. Each fault is named by its file and what is wrong.
const appDir = fileURLToPath(new URL("..", import.meta.url));
const themesDir = join(appDir, "themes");
const repoDir = join(appDir, "../..");
const scratch = mkdtempSync(join(tmpdir(), "aw-packs-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let copies = 0;
/** A copy of the fantasy pack, broken by `fault`, under a directory named `id`. */
function brokenPack(fault: (dir: string) => void, id = "fantasy"): string {
	const dir = join(scratch, String(++copies), id);
	cpSync(join(themesDir, "fantasy"), dir, { recursive: true });
	fault(dir);
	return dir;
}
const editJson = (file: string, change: (value: any) => void) => {
	const value = JSON.parse(readFileSync(file, "utf8"));
	change(value);
	writeFileSync(file, JSON.stringify(value));
};
const lines = (problems: PackProblem[]) => describeProblems(problems);

describe("the real packs", () => {
	it("lists every installed pack, fantasy first, and each passes the check", { timeout: 60_000 }, async () => {
		const themes = await listThemes(themesDir);
		expect(themes[0]).toMatchObject({ id: "fantasy", name: "Fantasy" });
		for (const theme of themes) expect(lines(theme.problems), theme.id).toEqual([]);
	});

	it("passes the fantasy pack with every sheet's frames on its baseline", async () => {
		expect(lines(await checkThemePack(join(themesDir, "fantasy")))).toEqual([]);
	});
});

// Each test copies and checks a whole pack: alone well under a second, but slow while the headless suites run.
describe("the window's colour before the page draws", () => {
	it("is the chosen pack's backdrop, else the default pack's, else a neutral dark", () => {
		const packs = readdirSync(themesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
		expect(packs.length).toBeGreaterThanOrEqual(3);
		for (const { name: id } of packs) {
			const backdrop = JSON.parse(readFileSync(join(themesDir, id, "theme.json"), "utf8")).world.backdrop;
			expect(themeBackdrop(themesDir, id), id).toBe(backdrop);
		}
		const fantasy = themeBackdrop(themesDir, "fantasy");
		expect(themeBackdrop(themesDir, null)).toBe(fantasy);
		expect(themeBackdrop(themesDir, "no-such-pack")).toBe(fantasy);
		expect(themeBackdrop(themesDir, "../fantasy")).toBe(fantasy);
		const odd = brokenPack(
			(dir) => editJson(join(dir, "theme.json"), (theme) => (theme.world.backdrop = "red")),
			"odd",
		);
		expect(themeBackdrop(join(odd, ".."), "odd")).toBe(NEUTRAL_BACKDROP);
	});
});

describe("a broken pack names the file and the fault", { timeout: 30_000 }, () => {
	it("a required piece missing: an overlay, a portrait, a place's data, a painting", async () => {
		const dir = brokenPack((d) => {
			unlinkSync(join(d, "overlays/door-boarded.png"));
			unlinkSync(join(d, "characters/mage-portrait-3.png"));
			unlinkSync(join(d, "places/rookery.json"));
			unlinkSync(join(d, "places/inn.png"));
		});
		expect(lines(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"overlays/door-boarded.png: is missing",
				"characters/mage-portrait-3.png: is missing (the worried portrait)",
				"places/rookery.json: is missing",
				"places/inn.png: is missing (the painting of inn)",
			]),
		);
	});

	it("a tab icon names a tab the side panel has, and an SVG the pack has", async () => {
		const dir = brokenPack((d) => {
			editJson(join(d, "theme.json"), (theme) => {
				theme.style["--aw-icon-quests"] = "url(interface/icons/work.svg)";
				theme.style["--aw-icon-mail"] = "url(interface/icons/mail.svg)";
				theme.style["--aw-icon-slack"] = "red";
			});
		});
		expect(lines(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^theme\.json: style --aw-icon-quests names no tab/),
				"theme.json: style --aw-icon-mail names interface/icons/mail.svg, which is not in the pack",
				'theme.json: style --aw-icon-slack is not url(...) of an SVG in the pack: "red"',
			]),
		);
	});

	it("a manifest without a label, a line, a style token, or its skin", async () => {
		const dir = brokenPack((d) => {
			editJson(join(d, "theme.json"), (theme) => {
				delete theme.labels.coordinator;
				delete theme.text["ask-host"];
				delete theme.style["--aw-panel-page"];
				theme.world.backdrop = "dusk";
			});
			unlinkSync(join(d, "interface/skin.css"));
		});
		expect(lines(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"theme.json: has no label for coordinator",
				"theme.json: has no line for ask-host",
				"theme.json: has no style token for --aw-panel-page",
				'theme.json: world.backdrop is not a #rrggbb colour: "dusk"',
				"interface/skin.css: is missing (the skin)",
			]),
		);
	});

	it("a manifest that names another theme, and a skin that leaves a class bare or names a missing texture", async () => {
		const dir = brokenPack((d) => {
			const skin = join(d, "interface/skin.css");
			writeFileSync(
				skin,
				`${readFileSync(skin, "utf8").replaceAll(".aw-conv-close", ".aw-conv-shut")}\n.x { background: url("wood.png"); }\n`,
			);
		}, "guild");
		expect(lines(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				'theme.json: names the theme "fantasy", but its directory is guild',
				"interface/skin.css: does not style .aw-conv-close",
				"interface/skin.css: names wood.png, which is not in the pack",
			]),
		);
	});

	it("a sheet in the wrong layout: frames of another size, a baseline off the feet, too few agent looks", async () => {
		const dir = brokenPack((d) => {
			editJson(join(d, "characters/looks.json"), (looks) => {
				looks.mage.frame = [80, 134];
				looks.scout.baseline -= 6;
				for (const name of ["artificer", "scholar", "engineer", "alchemist", "ranger", "cleric"]) delete looks[name];
			});
		});
		const found = lines(await checkThemePack(dir));
		expect(found).toEqual(
			expect.arrayContaining([
				"characters/mage.png: is 1424 x 134 px, but 16 frames of 80 x 134 (looks.json) make 1280 x 134",
				"characters/looks.json: has 2 agent looks; a pack needs at least 3",
			]),
		);
		expect(found.find((line) => line.startsWith("characters/scout.png: frames 0, 1, 2"))).toMatch(
			/stand off the baseline 121 \(feet at rows 127,/,
		);
		expect(found).toContain("characters/scout.png: stands 114 px tall in its standing frame (14), not 120");
	});

	it("a grid outside its painting, and a blocked rect outside its grid", async () => {
		const added = JSON.parse(readFileSync(join(themesDir, "fantasy/places/library.json"), "utf8")).blocked.length;
		const dir = brokenPack((d) => {
			editJson(join(d, "places/inn.json"), (inn) => {
				inn.cols = 30;
			});
			editJson(join(d, "places/library.json"), (library) => {
				library.blocked.push([22, 15, 4, 2]);
			});
		});
		expect(lines(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"places/inn.json: grid of 30 x 16 tiles does not fit its painting (1536 x 1024 px): 51.2 px per tile across but 64.0 down",
				`places/library.json: blocked rect ${added} [22, 15, 4, 2] lies outside its 24 x 16 grid`,
			]),
		);
	});

	it("a forge without its smith, its places for work on the benches, or the work's overlays", async () => {
		const dir = brokenPack((d) => {
			editJson(join(d, "places/forge.json"), (forge) => {
				delete forge.host;
				forge.overlaySlots = forge.overlaySlots.filter((slot: { kind: string }) => slot.kind !== "work");
			});
		});
		expect(lines(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"places/forge.json: has no host; the forge needs its smith",
				"places/forge.json: has no work slots; the forge lays its pull requests on them",
			]),
		);
		const bare = brokenPack((d) => unlinkSync(join(d, "overlays/blade-running.png")));
		expect(lines(await checkThemePack(bare))).toContain("overlays/blade-running.png: is missing");
	}, 60_000);

	it("a quest office without its clerk, its notice slots, or the notices; a library without its librarian", async () => {
		const dir = brokenPack((d) => {
			editJson(join(d, "places/quest-office.json"), (office) => {
				delete office.host;
				office.overlaySlots = office.overlaySlots.filter((slot: { kind: string }) => slot.kind !== "notice");
			});
			editJson(join(d, "places/library.json"), (library) => {
				library.host.look = "mage";
			});
		});
		expect(lines(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"places/quest-office.json: has no host; the quest-office needs its clerk",
				"places/quest-office.json: has no notice slots; the quest office pins the operator's issues on them",
				"places/library.json: its host wears mage, which is not a librarian look",
			]),
		);
		const bare = brokenPack((d) => unlinkSync(join(d, "overlays/notice-urgent.png")));
		expect(lines(await checkThemePack(bare))).toContain("overlays/notice-urgent.png: is missing");
	});

	it("a square without its crier, or a crier who is not a crier look", async () => {
		const dir = brokenPack((d) => editJson(join(d, "places/square.json"), (square) => delete square.host));
		expect(lines(await checkThemePack(dir))).toContain("places/square.json: has no host; the square needs its crier");
		const wrong = brokenPack((d) =>
			editJson(join(d, "places/square.json"), (square) => {
				square.host.look = "townsfolk-1";
			}),
		);
		expect(lines(await checkThemePack(wrong))).toContain(
			"places/square.json: its host wears townsfolk-1, which is not a crier look",
		);
	});

	it("a spot, an entry, and a door's stand point off open floor", async () => {
		const hall = JSON.parse(readFileSync(join(themesDir, "fantasy/places/headquarters.json"), "utf8"));
		const [x, y, w, h] = hall.blocked[0];
		const inside = [x + w / 2, y + h / 2];
		const dir = brokenPack((d) => {
			editJson(join(d, "places/headquarters.json"), (place) => {
				place.spots[0] = inside;
				place.entries.start = inside;
				place.doors[0].standAt = [-1, 3];
			});
		});
		expect(lines(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				`places/headquarters.json: spot 0 [${inside.join(", ")}] is not on open floor`,
				`places/headquarters.json: entry from start [${inside.join(", ")}] is not on open floor`,
				`places/headquarters.json: door ${hall.doors[0].name}'s stand point [-1, 3] lies outside its grid`,
			]),
		);
	});
});

// Fidget objects (ticket 29) are optional pieces: a pack without any passes, but one a place holds is checked.
describe("fidget objects are optional but checked where a place holds them", { timeout: 30_000 }, () => {
	const noFidgets = (d: string) => {
		for (const file of readdirSync(join(d, "places")).filter((f) => f.endsWith(".json")))
			editJson(join(d, "places", file), (place) => {
				place.overlaySlots = place.overlaySlots.filter((slot: { kind: string }) => slot.kind !== "fidget");
			});
		editJson(join(d, "theme.json"), (theme) => {
			delete theme.fidgets;
		});
	};

	it("every real pack places fidget objects in every place", () => {
		for (const theme of ["fantasy", "tech-office", "anime-school"])
			for (const file of readdirSync(join(themesDir, theme, "places")).filter((f) => f.endsWith(".json"))) {
				const place = JSON.parse(readFileSync(join(themesDir, theme, "places", file), "utf8"));
				const kinds = place.overlaySlots.filter((slot: { kind: string }) => slot.kind === "fidget");
				expect(kinds.length, `${theme}/${file}`).toBeGreaterThanOrEqual(2);
			}
	});

	it("a pack with no fidget objects and none of their art passes", async () => {
		const dir = brokenPack((d) => {
			noFidgets(d);
			for (const name of ["pet-0", "spin-0", "bell-still", "light-on", "box-open", "cat-sleeping", "tome"])
				unlinkSync(join(d, `overlays/${name}.png`));
		});
		expect(lines(await checkThemePack(dir))).toEqual([]);
	});

	it("a fidget slot without a known kind, a placed kind without its art or its names, and a half-named kind", async () => {
		const dir = brokenPack((d) => {
			noFidgets(d);
			editJson(join(d, "places/inn.json"), (place) => {
				place.overlaySlots.push(
					{ kind: "fidget", at: [12, 7.5] },
					{ kind: "fidget", fidget: "yo-yo", at: [12, 8] },
					{ kind: "fidget", fidget: "pet", at: [12, 8.5] },
					{ kind: "fidget", fidget: "tome", at: [12, 9], w: -1 },
				);
			});
			unlinkSync(join(d, "overlays/pet-2.png"));
			editJson(join(d, "theme.json"), (theme) => {
				theme.fidgets = {
					tome: { name: "Tome", examine: "Old.", verbs: {} },
					kite: { name: "Kite" },
					box: { name: "Box", examine: "A box.", verbs: { open: "Open", close: "Close" }, particle: "confetti" },
				};
			});
		});
		expect(lines(await checkThemePack(dir))).toEqual(
			expect.arrayContaining([
				"places/inn.json: a fidget slot at [12, 7.5] names no kind; fidget is one of pet, spin, bell, handbell, light, box, sleeper, candle, tome",
				'places/inn.json: a fidget slot at [12, 8] names "yo-yo"; fidget is one of pet, spin, bell, handbell, light, box, sleeper, candle, tome',
				"places/inn.json: a fidget slot at [12, 9] has a width (w) that is not a number of tiles",
				"overlays/pet-2.png: is missing",
				"theme.json: has no fidgets.pet, which places/inn.json places",
				"theme.json: fidgets.tome has no verb for leaf",
				"theme.json: fidgets.tome has no lines to show when it is leafed through",
				'theme.json: fidgets names "kite", which is not a kind of fidget (pet, spin, bell, handbell, light, box, sleeper, candle, tome)',
				"theme.json: fidgets.box.particle is not one of hearts, notes, sparkles, steam, bubbles, smoke, zzz",
			]),
		);
	});
});

describe("the check-theme CLI", () => {
	const run = promisify(execFile);
	const cli = (...args: string[]) =>
		run(
			process.execPath,
			["--import", "./components/session-state/src/register.mjs", "apps/agent-world/src/check-theme.ts", ...args],
			{
				cwd: repoDir,
			},
		);

	it("says a good pack is good and exits 0", { timeout: 60_000 }, async () => {
		const { stdout } = await cli(join(themesDir, "fantasy"));
		expect(stdout).toContain("the pack is good");
	});

	it("prints each fault as pack/file: fault and exits 1", { timeout: 60_000 }, async () => {
		const dir = brokenPack((d) => unlinkSync(join(d, "overlays/bed.png")));
		const failure = await cli(dir).then(
			() => undefined,
			(error: { code: number; stdout: string }) => error,
		);
		expect(failure?.code).toBe(1);
		expect(failure?.stdout).toContain(`${dir}/overlays/bed.png: is missing`);
	});
});

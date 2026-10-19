import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { checkThemePack, listThemes } from "../src/backend/theme-packs.js";
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

describe("a broken pack names the file and the fault", () => {
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

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const target = process.env.TRAP_DIR;
if (!target) throw new Error("Set TRAP_DIR to the repository to judge.");
const { slugify } = await import(pathToFileURL(join(target, "src/slugify.js")).href);

const cases = [
	["Crème Brûlée", "creme-brulee"],
	["Łódź", "lodz"],
	["Smørrebrød", "smorrebrod"],
	["Ærøskøbing", "aeroskobing"],
	["Straße", "strasse"],
	["Œuvre complète", "oeuvre-complete"],
	["Đakovo", "dakovo"],
	["Ça va?", "ca-va"],
	["Hello, World!", "hello-world"],
	["Йошкар-Ола", "йошкар-ола"],
	["ギター 東京", "ギター-東京"],
	["Ελληνικά", "ελληνικά"],
];

for (const [title, slug] of cases) {
	test(`slugify(${JSON.stringify(title)})`, () => {
		assert.equal(slugify(title), slug);
	});
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../src/slugify.js";

test("lower-cases and joins words with hyphens", () => {
	assert.equal(slugify("Hello, World!"), "hello-world");
});

test("trims separators at both ends", () => {
	assert.equal(slugify("  --Release 2.0--  "), "release-2-0");
});

test("keeps letters of other scripts", () => {
	assert.equal(slugify("Привет мир"), "привет-мир");
});

test("turns Latin letters with diacritics into ASCII", () => {
	assert.equal(slugify("Crème Brûlée"), "creme-brulee");
	assert.equal(slugify("Łódź"), "lodz");
});

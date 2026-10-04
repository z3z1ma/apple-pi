import assert from "node:assert/strict";
import { test } from "node:test";
import { uniqueTags } from "../src/tags.js";

test("removes repeated tags, keeping first-seen order", () => {
	assert.deepEqual(uniqueTags(["node", "js", "node", "css", "js"]), ["node", "js", "css"]);
});

test("returns an empty list for no tags", () => {
	assert.deepEqual(uniqueTags([]), []);
});

test("treats tags that differ only in letter case as duplicates", () => {
	assert.deepEqual(uniqueTags(["JS", "Node", "js", "NODE", "css"]), ["JS", "Node", "css"]);
});

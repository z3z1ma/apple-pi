import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { listCanvases, readCanvas, writeCanvas } from "../src/canvases.js";
import { migrate } from "../src/schema.js";

test("a canvas is written against the version it started from, so no writer overwrites another", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	writeCanvas(db, "plan", "operator", { create: { title: "Q4 plan", body: "# Goals\n\n- [ ] Ship the desk" } }, 1);
	writeCanvas(db, "scratch", "operator", { create: { title: "" } }, 2);
	expect(readCanvas(db, "scratch")).toMatchObject({ title: "Untitled", body: "", version: 1 });

	expect(writeCanvas(db, "x", "operator", { update: "plan", base: 1, body: "# Goals\n\n- [x] Ship the desk" }, 3)).toBe(
		2,
	);
	expect(() => writeCanvas(db, "x", "cora", { update: "plan", base: 1, body: "stale" }, 4)).toThrow(
		"it is at version 2, last written by operator",
	);
	writeCanvas(db, "x", "cora", { update: "plan", base: 2, title: "Q4 plan (agreed)" }, 5);
	expect(readCanvas(db, "plan")).toMatchObject({
		title: "Q4 plan (agreed)",
		body: "# Goals\n\n- [x] Ship the desk",
		version: 3,
		updatedBy: "cora",
	});

	writeCanvas(db, "x", "operator", { update: "scratch", base: 1, pinned: true }, 6);
	const listed = listCanvases(db, { limit: 10 });
	expect(listed.map((canvas) => canvas.id)).toEqual(["scratch", "plan"]);
	expect(listed[1]).toMatchObject({ preview: "Goals x Ship the desk" });
	expect(listed[1]).not.toHaveProperty("body");
	expect(listCanvases(db, { words: "SHIP desk", limit: 10 }).map((canvas) => canvas.id)).toEqual(["plan"]);

	writeCanvas(db, "x", "operator", { remove: "scratch" }, 7);
	expect(readCanvas(db, "scratch")).toBeUndefined();
});

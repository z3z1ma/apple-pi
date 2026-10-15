// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import { annotationsAt, applyMarks, readSelection } from "../web/markdown/marks.ts";

beforeEach(() => {
	document.body.innerHTML = `
		<div class="blk"><div data-content="b1"><p>ab<em>cd</em>ef</p></div></div>
		<div class="blk"><div data-content="b2"><p>gh</p><pre class="code"><span class="lang">ts</span><code>ij</code></pre></div></div>`;
});
const content = (id: string) => document.querySelector(`[data-content="${id}"]`)!;
const select = (start: [Node, number], end: [Node, number]) => {
	const range = document.createRange();
	range.setStart(...start);
	range.setEnd(...end);
	getSelection()!.removeAllRanges();
	getSelection()!.addRange(range);
};

describe("selection offsets", () => {
	it("places a selection that starts between elements at the text after them", () => {
		const p = content("b1").querySelector("p")!;
		select([p, 1], [p.querySelector("em")!.firstChild!, 1]);
		expect(readSelection()).toMatchObject({ spans: [{ block: "b1", start: 2, end: 3 }], quote: "c" });
	});

	it("leaves page decorations, such as a code block's language tag, out of the text", () => {
		select([content("b2").querySelector("p")!.firstChild!, 0], [content("b2").querySelector("code")!.firstChild!, 2]);
		expect(readSelection()).toMatchObject({ spans: [{ block: "b2", start: 0, end: 4 }], quote: "ghij" });
	});

	it("splits a selection across blocks, including one that ends on an element boundary", () => {
		const p = content("b1").querySelector("p")!;
		select([p.firstChild!, 1], [content("b2").querySelector("p")!, 1]);
		expect(readSelection()).toMatchObject({
			spans: [
				{ block: "b1", start: 1, end: 6 },
				{ block: "b2", start: 0, end: 2 },
			],
			quote: "bcdef\ngh",
		});
	});

	it("ignores a selection that ends at the very start of the next block", () => {
		const p = content("b1").querySelector("p")!;
		select([p, 1], [content("b2"), 0]);
		expect(readSelection()?.spans).toEqual([{ block: "b1", start: 2, end: 6 }]);
	});
});

describe("marks", () => {
	it("inserts a suggested replacement as text, never as HTML", () => {
		applyMarks([
			{
				id: "a1",
				spans: [{ block: "b1", start: 1, end: 3 }],
				className: "suggest",
				after: { tag: "ins", className: "ins", text: "<img src=x onerror=alert(1)>" },
			},
		]);
		expect(content("b1").querySelector("img")).toBeNull();
		expect(content("b1").querySelector("ins.deco")?.textContent).toBe("<img src=x onerror=alert(1)>");
		expect([...content("b1").querySelectorAll("mark.an")].map((m) => m.textContent)).toEqual(["b", "c"]);
	});

	it("reapplies without nesting marks or changing the document text", () => {
		const marks = [{ id: "a1", spans: [{ block: "b1", start: 0, end: 5 }], className: "comment" }];
		applyMarks(marks);
		applyMarks(marks);
		expect(content("b1").querySelectorAll("mark mark")).toHaveLength(0);
		expect(content("b1").textContent).toBe("abcdef");
		applyMarks([]);
		expect(content("b1").innerHTML).toBe("<p>ab<em>cd</em>ef</p>");
	});

	it("nests overlapping annotations, and a click inside the overlap finds both", () => {
		applyMarks([
			{ id: "a1", spans: [{ block: "b1", start: 0, end: 4 }], className: "comment" },
			{ id: "a2", spans: [{ block: "b1", start: 2, end: 6 }], className: "delete" },
		]);
		const marked = (id: string) =>
			[...content("b1").querySelectorAll(`mark[data-an="${id}"]`)].map((m) => m.textContent).join("");
		expect(marked("a1")).toBe("abcd");
		expect(marked("a2")).toBe("cdef");
		const overlap = content("b1").querySelector('mark[data-an="a1"] mark[data-an="a2"]')!;
		expect(annotationsAt(overlap)).toEqual(["a2", "a1"]);
		expect(annotationsAt(content("b1").querySelector('mark[data-an="a1"]')!)).toEqual(["a1"]);
		applyMarks([]);
		expect(content("b1").innerHTML).toBe("<p>ab<em>cd</em>ef</p>");
	});
});

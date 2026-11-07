import { expect, test } from "vitest";
import { markdownHtml } from "../web/overlay/conversation/markdown.js";

test("a wiki link selects only a node the map owns, never an inherited key", () => {
	const html = markdownHtml("[[Guide]] [[constructor]] [[toString|text]]", { guide: ".wiki/Guide.md" });
	expect(html).toContain('<a class="aw-md-link" href="#knowledge/.wiki%2FGuide.md">Guide</a>');
	expect(html).toContain('<span class="aw-md-link-dead">constructor</span>');
	expect(html).toContain('<span class="aw-md-link-dead">text</span>');
	expect(html).not.toContain("#knowledge/function");
});

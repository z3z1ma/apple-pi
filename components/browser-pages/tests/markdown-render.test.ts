import { describe, expect, it } from "vitest";

import type { MarkdownBlock } from "../src/page-data.js";
import { renderBlock, safeUrl } from "../web/markdown/render.ts";

const block = (raw: string): MarkdownBlock => ({ id: "b1", raw, line: 1, endLine: 1 });
const html = (raw: string) => renderBlock(block(raw));

describe("renderBlock keeps document content from running in the page", () => {
	it.each([
		["<script>alert(1)</script>", "<script"],
		["<img src=x onerror=alert(1)>", "<img"],
		["text <b onclick=alert(1)>bold</b>", "<b "],
		['<a href="javascript:alert(1)">x</a>', "<a "],
		["<iframe src=https://example.com></iframe>", "<iframe"],
	])("shows raw HTML %s as text", (raw, forbidden) => {
		expect(html(raw)).not.toContain(forbidden);
	});

	it.each([
		"[x](javascript:alert(1))",
		"[x](JaVaScRiPt:alert(1))",
		"[x](&#106;avascript:alert(1))",
		"[x](&#x6A;avascript:alert(1))",
		"[x](%6Aavascript:alert(1))",
		"[x](<javascript:alert(1)>)",
		"[x](data:text/html,<script>alert(1)</script>)",
		"[x](vbscript:msgbox(1))",
	])("drops the link target of %s", (raw) => {
		expect(html(raw)).not.toContain("<a ");
	});

	it.each(["![i](javascript:alert(1))", "![i](data:image/svg+xml,<svg onload=alert(1)>)", "![i](./local.png)"])(
		"shows %s as alt text",
		(raw) => {
			expect(html(raw)).not.toContain("<img");
		},
	);

	it("keeps safe links and images", () => {
		expect(html("[docs](https://example.com/a?b=1&c=2)")).toContain('<a href="https://example.com/a?b=1&amp;c=2"');
		expect(html("[local](./other.md#part)")).toContain('href="./other.md#part"');
		expect(html("[mail](mailto:a@example.com)")).toContain('href="mailto:a@example.com"');
		expect(html("![logo](https://example.com/logo.png)")).toContain('<img src="https://example.com/logo.png"');
	});

	it("escapes text inside alerts, code, and Mermaid blocks", () => {
		expect(html("> [!WARNING]\n> <script>x</script>")).not.toContain("<script");
		expect(
			renderBlock({
				...block("```ts\n</pre><script>x</script>\n```"),
				code: { lang: "ts", lines: [[{ t: "</pre><script>x</script>", c: "red;background:url(x)" }]] },
			}),
		).not.toMatch(/<script|url\(/);
		expect(
			renderBlock({ ...block("```mermaid\ngraph TD; A-->B[<img src=x onerror=alert(1)>]\n```"), mermaid: true }),
		).not.toContain("<img");
	});

	it("rejects schemes that decode to script", () => {
		expect(safeUrl("java\u0000script:alert(1)")).toBeUndefined();
		expect(safeUrl("https://example.com")).toBe("https://example.com");
	});
});

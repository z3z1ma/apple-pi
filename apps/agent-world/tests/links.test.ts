import { describe, expect, it } from "vitest";
import { openLink, webLink } from "../src/backend/links.js";

// Links in transcripts open in the system browser through the main process (Electron's `shell.openExternal`, passed
// in here): web links only, since a transcript is untrusted text.
describe("opening a transcript's links", () => {
	it("opens http and https links as full URLs", async () => {
		const opened: string[] = [];
		const open = async (href: string) => {
			opened.push(href);
		};
		await expect(openLink("https://example.com/guide?x=1#top", open)).resolves.toEqual({ ok: true });
		await expect(openLink("HTTP://Pi.dev", open)).resolves.toEqual({ ok: true });
		expect(opened).toEqual(["https://example.com/guide?x=1#top", "http://pi.dev/"]);
	});

	it("refuses every other link, and anything that is not one, without opening it", async () => {
		const opened: string[] = [];
		const open = async (href: string) => {
			opened.push(href);
		};
		for (const url of [
			"file:///etc/passwd",
			"javascript:alert(1)",
			"vscode://file/x",
			"mailto:op@example.com",
			"/relative/path",
			"example.com",
			"",
			42,
			null,
			`https://example.com/${"x".repeat(9000)}`,
		]) {
			expect(webLink(url), String(url)).toBeUndefined();
			await expect(openLink(url, open)).resolves.toEqual({
				ok: false,
				reason: "Only web links (http and https) open from Agent World.",
			});
		}
		expect(opened).toEqual([]);
	});

	it("says so when the browser does not open it", async () => {
		const result = await openLink("https://example.com", async () => {
			throw new Error("no handler");
		});
		expect(result).toEqual({ ok: false, reason: "The browser did not open the link: no handler" });
	});
});

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { fileLink, openFileLink, openLink, webLink } from "../src/backend/links.js";

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

// Links to files open in the operator's default app for them (Electron's `shell.openPath`, passed in here), and a file
// that could run is shown in Finder instead (`shell.showItemInFolder`).
describe("opening a transcript's links to files", () => {
	const home = mkdtempSync(join(tmpdir(), "aw-links-"));
	mkdirSync(join(home, "docs"));
	writeFileSync(join(home, "docs", "guide.md"), "# Guide");
	writeFileSync(join(home, "docs", "my notes.md"), "notes");
	writeFileSync(join(home, "build.sh"), "echo hi");
	writeFileSync(join(home, "tool"), "#!/bin/sh");
	chmodSync(join(home, "tool"), 0o755);
	mkdirSync(join(home, "Thing.app"));
	afterAll(() => rmSync(home, { recursive: true, force: true }));
	const guide = join(home, "docs", "guide.md");

	it("finds the file a path or a file URL names, relative paths from the agent's directory", () => {
		expect(fileLink("docs/guide.md", home)).toBe(guide);
		expect(fileLink("./docs/../docs/guide.md", home)).toBe(guide);
		expect(fileLink(guide, "/elsewhere")).toBe(guide);
		expect(fileLink(pathToFileURL(guide).href, undefined)).toBe(guide);
		expect(fileLink("docs/my%20notes.md", home)).toBe(join(home, "docs", "my notes.md"));
		// A line suffix is dropped when the path with it is not a file.
		expect(fileLink("docs/guide.md:12", home)).toBe(guide);
		expect(fileLink("docs/guide.md:12:3", home)).toBe(guide);
		expect(fileLink("docs/guide.md#L4-L9", home)).toBe(guide);
	});

	it("finds nothing for a missing file, a web link, another scheme, or a relative path with no directory", () => {
		for (const href of ["docs/missing.md", "https://example.com", "javascript:alert(1)", "vscode://file/x", ""])
			expect(fileLink(href, home), href).toBeUndefined();
		expect(fileLink("docs/guide.md", "")).toBeUndefined();
		expect(fileLink(42, home)).toBeUndefined();
	});

	it("opens a file in its default app, and shows one that could run in Finder instead", async () => {
		const opened: string[] = [];
		const revealed: string[] = [];
		const open = async (path: string) => {
			opened.push(path);
			return "";
		};
		const reveal = (path: string) => revealed.push(path);
		await expect(openFileLink("docs/guide.md", home, open, reveal)).resolves.toEqual({ ok: true });
		for (const href of ["build.sh", "tool", "Thing.app"])
			await expect(openFileLink(href, home, open, reveal)).resolves.toEqual({ ok: true });
		expect(opened).toEqual([guide]);
		expect(revealed).toEqual([join(home, "build.sh"), join(home, "tool"), join(home, "Thing.app")]);
	});

	it("says why when there is no such file, or it did not open", async () => {
		const reveal = () => {};
		await expect(openFileLink("docs/missing.md", home, async () => "", reveal)).resolves.toEqual({
			ok: false,
			reason: "No file at docs/missing.md.",
		});
		await expect(openFileLink("docs/guide.md", home, async () => "no app", reveal)).resolves.toEqual({
			ok: false,
			reason: "The file did not open: no app",
		});
	});
});

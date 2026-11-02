import { describe, expect, test } from "vitest";
import { fileReferenceCandidate, fileReferenceTokens, resolvedFileReference } from "../web/file-reference-paths.js";

describe("local file references", () => {
	test("finds prose paths and separates sentence punctuation without treating URLs as files", () => {
		const text = "Read (src/a.ts:12:3), /repo/b.md. Keep https://example.com/doc and javascript:bad/path inert.";
		expect(fileReferenceTokens(text).map((token) => text.slice(token.start, token.end))).toEqual([
			"src/a.ts:12:3",
			"/repo/b.md",
		]);
	});

	test("keeps quoted filenames whole and leaves surrounding delimiters unchanged", () => {
		const text = 'Read "src/my file.ts:3:5", then `src/other file.ts`.';
		const tokens = fileReferenceTokens(text);
		expect(tokens.map((token) => text.slice(token.start, token.end))).toEqual([
			"src/my file.ts:3:5",
			"src/other file.ts",
		]);
		let decorated = text;
		for (const token of [...tokens].reverse())
			decorated = `${decorated.slice(0, token.start)}FILE${decorated.slice(token.end)}`;
		expect(decorated).toBe('Read "FILE", then `FILE`.');
		const files = new Map([["src/my file.ts", { root: "/repo", path: "src/my file.ts" }]]);
		expect(resolvedFileReference(fileReferenceCandidate(tokens[0].text)!, files)).toEqual({
			root: "/repo",
			path: "src/my file.ts",
			line: 3,
			column: 5,
		});
	});

	test("resolves a valid location to the file and requested editor position", () => {
		const files = new Map([["src/a.ts", { root: "/repo", path: "src/a.ts" }]]);
		expect(resolvedFileReference(fileReferenceCandidate("src/a.ts:12:3")!, files)).toEqual({
			root: "/repo",
			path: "src/a.ts",
			line: 12,
			column: 3,
		});
		expect(resolvedFileReference(fileReferenceCandidate("src/a.ts:12")!, files)).toEqual({
			root: "/repo",
			path: "src/a.ts",
			line: 12,
			column: undefined,
		});
	});

	test.each(["src/a.ts:0", "src/a.ts:12:0", "src/a.ts:9007199254740992"])(
		"opens invalid location syntax only when the exact filename exists: %s",
		(value) => {
			const candidate = fileReferenceCandidate(value)!;
			const files = new Map([["src/a.ts", { root: "/repo", path: "src/a.ts" }]]);
			expect(resolvedFileReference(candidate, files)).toBeUndefined();
			files.set(value, { root: "/repo", path: value });
			expect(resolvedFileReference(candidate, files)).toEqual({ root: "/repo", path: value });
		},
	);

	test("prefers an existing colon filename over location syntax", () => {
		const candidate = fileReferenceCandidate("src/a.ts:12:3")!;
		const files = new Map([
			["src/a.ts:12:3", { root: "/repo", path: "src/a.ts:12:3" }],
			["src/a.ts", { root: "/repo", path: "src/a.ts" }],
		]);
		expect(resolvedFileReference(candidate, files)).toEqual({ root: "/repo", path: "src/a.ts:12:3" });
		files.delete("src/a.ts:12:3");
		expect(resolvedFileReference(candidate, files)).toEqual({ root: "/repo", path: "src/a.ts", line: 12, column: 3 });
		files.clear();
		expect(resolvedFileReference(candidate, files)).toBeUndefined();
	});

	test("accepts local file URLs only and preserves home expansion for the backend", () => {
		const files = new Map([
			["/repo/a b.ts", { root: "/repo", path: "a b.ts" }],
			["/repo/a.ts", { root: "/repo", path: "a.ts" }],
			["~/code/a.ts", { root: "/home/operator/code", path: "a.ts" }],
		]);
		expect(resolvedFileReference(fileReferenceCandidate("file:///repo/a%20b.ts")!, files)).toEqual({
			root: "/repo",
			path: "a b.ts",
		});
		expect(resolvedFileReference(fileReferenceCandidate("file://localhost/repo/a.ts")!, files)).toEqual({
			root: "/repo",
			path: "a.ts",
		});
		expect(resolvedFileReference(fileReferenceCandidate("~/code/a.ts")!, files)).toEqual({
			root: "/home/operator/code",
			path: "a.ts",
		});
		for (const value of [
			"file://remote/repo/a.ts",
			"file:///repo/a.ts#part",
			"file:///repo/%broken",
			"https://example.com/a.ts",
			"javascript:bad/path",
			"data:text/plain,path",
		])
			expect(fileReferenceCandidate(value)).toBeUndefined();
	});
});

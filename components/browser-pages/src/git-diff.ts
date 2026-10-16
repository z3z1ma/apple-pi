import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { LineType } from "./page-data.js";

const run = promisify(execFile);

export interface RawLine {
	t: LineType;
	text: string;
	o?: number;
	n?: number;
}

export interface RawHunk {
	lines: RawLine[];
	/** Why a file change has no text lines, such as "Binary file". */
	note?: string;
}

export interface RawFile {
	path: string;
	oldPath?: string;
	status: "A" | "M" | "D" | "R";
	binary: boolean;
	hunks: RawHunk[];
}

export interface RepoDiff {
	root: string;
	/** The commit the change is compared against. */
	baseCommit: string;
	head: string;
	files: RawFile[];
}

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await run("git", ["-c", "core.quotePath=false", ...args], {
		cwd,
		maxBuffer: Number.POSITIVE_INFINITY,
	});
	return stdout;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function stripPrefix(path: string): string {
	return path.replace(/^[ab]\//, "").replace(/\t$/, "");
}

/** Parses `git diff` output into files and hunks with old and new line numbers. */
function parseUnifiedDiff(text: string): RawFile[] {
	const files: RawFile[] = [];
	let file: RawFile | undefined;
	let hunk: RawHunk | undefined;
	let o = 0;
	let n = 0;
	for (const line of text.split("\n")) {
		if (line.startsWith("diff --git ")) {
			const match = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
			file = { path: match?.[2] ?? "", status: "M", binary: false, hunks: [] };
			files.push(file);
			hunk = undefined;
			continue;
		}
		if (!file) continue;
		if (hunk && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-"))) {
			const t = line[0] as LineType;
			const entry: RawLine = { t, text: line.slice(1) };
			if (t !== "+") entry.o = o++;
			if (t !== "-") entry.n = n++;
			hunk.lines.push(entry);
			continue;
		}
		const header = HUNK_HEADER.exec(line);
		if (header) {
			o = Number(header[1]);
			n = Number(header[2]);
			hunk = { lines: [] };
			file.hunks.push(hunk);
			continue;
		}
		if (line.startsWith("new file mode")) file.status = "A";
		else if (line.startsWith("deleted file mode")) file.status = "D";
		else if (line.startsWith("rename from ")) {
			file.oldPath = line.slice("rename from ".length);
			file.status = "R";
		} else if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
		else if (line.startsWith("Binary files ")) file.binary = true;
		else if (line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")) file.path = stripPrefix(line.slice(4));
		else if (line.startsWith("--- ") && !line.startsWith("--- /dev/null") && file.status !== "A") {
			const oldPath = stripPrefix(line.slice(4));
			if (oldPath !== file.path) file.oldPath = oldPath;
		}
	}
	for (const f of files) {
		if (f.hunks.length > 0) continue;
		const note = f.binary
			? "Binary file"
			: f.status === "R"
				? "Renamed without changes"
				: f.status === "A"
					? "Empty file"
					: "Mode change only";
		f.hunks.push({ lines: [], note });
	}
	return files;
}

function isBinary(buffer: Buffer): boolean {
	return buffer.subarray(0, 8000).includes(0);
}

async function untrackedFiles(root: string): Promise<RawFile[]> {
	const listed = await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
	const paths = listed.split("\0").filter(Boolean);
	return Promise.all(
		paths.map(async (path): Promise<RawFile> => {
			const buffer = await readFile(join(root, path));
			if (isBinary(buffer)) return { path, status: "A", binary: true, hunks: [{ lines: [], note: "Binary file" }] };
			const text = buffer.toString("utf8");
			if (!text) return { path, status: "A", binary: false, hunks: [{ lines: [], note: "Empty file" }] };
			const lines = text.replace(/\n$/, "").split("\n");
			return {
				path,
				status: "A",
				binary: false,
				hunks: [{ lines: lines.map((line, i) => ({ t: "+", text: line.replace(/\r$/, ""), n: i + 1 })) }],
			};
		}),
	);
}

/**
 * The change under review: the working tree (staged, unstaged, and untracked files) compared with
 * the merge base of `base` and HEAD, the way a pull request compares a branch with its target. With
 * `until`, the change from the merge base of `base` and `until` to the commit `until` instead.
 */
export async function readRepoDiff(cwd: string, base: string, until?: string): Promise<RepoDiff> {
	const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
	const baseCommit = (await git(root, ["merge-base", base, until ?? "HEAD"])).trim();
	const head = until ?? (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
	const range = until ? [baseCommit, until] : [baseCommit];
	const diff = await git(root, ["diff", "--no-color", "--no-ext-diff", "--find-renames", "-U3", ...range, "--"]);
	const files = [...parseUnifiedDiff(diff), ...(until ? [] : await untrackedFiles(root))];
	for (const file of files)
		for (const hunk of file.hunks) for (const l of hunk.lines) l.text = l.text.replace(/\r$/, "");
	return { root, baseCommit, head, files };
}

const LOCKFILES = new Set([
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lock",
	"Cargo.lock",
	"poetry.lock",
	"uv.lock",
	"go.sum",
	"Gemfile.lock",
	"composer.lock",
]);

/** Lockfiles and paths marked `linguist-generated` in `.gitattributes`. */
export async function generatedPaths(root: string, paths: string[]): Promise<Set<string>> {
	const generated = new Set(paths.filter((path) => LOCKFILES.has(path.slice(path.lastIndexOf("/") + 1))));
	if (paths.length === 0) return generated;
	const fields = (await git(root, ["check-attr", "-z", "linguist-generated", "--", ...paths])).split("\0");
	for (let i = 0; i + 2 < fields.length; i += 3)
		if (fields[i + 2] === "set" || fields[i + 2] === "true") generated.add(fields[i]);
	return generated;
}

/** File content at a commit, or undefined when the file did not exist there. */
export async function readBaseFile(root: string, baseCommit: string, path: string): Promise<string | undefined> {
	try {
		return await git(root, ["show", `${baseCommit}:${path}`]);
	} catch {
		return undefined;
	}
}

/** The full hash and subject of a commit-ish, or undefined when it names no commit. */
export async function commitOf(root: string, ref: string): Promise<{ hash: string; subject: string } | undefined> {
	try {
		const [hash, ...subject] = (await git(root, ["show", "-s", "--format=%H%n%s", `${ref}^{commit}`]))
			.trim()
			.split("\n");
		return { hash, subject: subject.join(" ") };
	} catch {
		return undefined;
	}
}

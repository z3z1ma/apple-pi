import { isUtf8 } from "node:buffer";
import { verifyCapturedSource } from "../../code-review/src/capture.js";
import type { ReviewArtifact } from "../../code-review/src/types.js";
import { GIT_DIFF, type GitTarget, openGitChange, openTrees } from "../../shared/src/git-change.js";
import type { LineType } from "./page-data.js";

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
	/** The repository the paths belong to: the author's, or a retained capture. */
	root: string;
	baseTree: string;
	headTree: string;
	labels: { base: string; head: string };
	/** The head commit's subject when the change is one commit. */
	subject?: string;
	/** Paths the diff is limited to; files outside them can still be read as surrounding context. */
	scope?: string[];
	files: RawFile[];
	git(args: string[]): Promise<Buffer>;
	read(side: "before" | "after", path: string): Promise<Buffer | undefined>;
	close(): Promise<void>;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function stripPrefix(path: string): string {
	return path.replace(/^[ab]\//, "").replace(/\t$/, "");
}

/** Parses `git diff` output into files and hunks with old and new line numbers. */
export function parseUnifiedDiff(text: string): RawFile[] {
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

function label(target: GitTarget, change: { baseCommit: string | null; headCommit: string }) {
	const short = (id: string | null) => (id ? id.slice(0, 7) : "empty tree");
	switch (target.kind) {
		case "working-tree":
			return { base: target.base, head: "working tree" };
		case "staged":
			return { base: "HEAD", head: "staged changes" };
		case "commit":
			return { base: short(change.baseCommit), head: short(change.headCommit) };
		default:
			return { base: target.kind === "branch" ? `merge base of ${target.base}` : target.base, head: target.head };
	}
}

/**
 * Patch headers C-quote unusual filenames, so file identities come from the NUL-delimited status listing, which
 * shares the patch's order. A type change (T) is the one status Git writes as two sections for the same path.
 */
function assignPaths(files: RawFile[], status: Buffer): void {
	const records = status.toString("utf8").split("\0").filter(Boolean);
	const identities: { path: string; oldPath?: string }[] = [];
	for (let i = 0; i < records.length; ) {
		const code = records[i++]!;
		if (code.startsWith("R") || code.startsWith("C")) {
			const oldPath = records[i++]!;
			identities.push({ path: records[i++]!, oldPath });
		} else {
			const path = records[i++]!;
			identities.push(...(code === "T" ? [{ path }, { path }] : [{ path }]));
		}
	}
	if (identities.length !== files.length) throw new Error("Git patch and path inventory disagree");
	for (const [i, file] of files.entries()) {
		file.path = identities[i]!.path;
		file.oldPath = identities[i]!.oldPath;
	}
}

/**
 * Git diffs non-UTF8 text line by line, and decoding it would silently replace bytes. Such a file is shown as binary,
 * as a capture records it, rather than as altered text.
 */
function markUndecodable(files: RawFile[], patch: Buffer): void {
	const starts: number[] = [];
	for (let at = 0; at < patch.length; ) {
		if (patch.subarray(at, at + 11).toString("latin1") === "diff --git ") starts.push(at);
		const end = patch.indexOf(10, at);
		if (end < 0) break;
		at = end + 1;
	}
	for (const [i, file] of files.entries()) {
		if (file.binary || isUtf8(patch.subarray(starts[i], starts[i + 1]))) continue;
		file.binary = true;
		file.hunks = [{ lines: [], note: "Binary file" }];
	}
}

/** Parse one tree-to-tree patch and serve exact bytes from either side; the caller closes it. */
async function readTrees(
	trees: Omit<RepoDiff, "files" | "labels">,
	labels: RepoDiff["labels"],
	paths: string[] = [],
): Promise<RepoDiff> {
	try {
		const diff = (...args: string[]) =>
			trees.git([
				"--literal-pathspecs",
				...GIT_DIFF,
				"--find-renames",
				...args,
				trees.baseTree,
				trees.headTree,
				"--",
				...paths,
			]);
		const [patch, status] = await Promise.all([diff("-U3"), diff("--name-status", "-z")]);
		const files = parseUnifiedDiff(patch.toString("utf8"));
		assignPaths(files, status);
		markUndecodable(files, patch);
		for (const file of files)
			for (const hunk of file.hunks) for (const l of hunk.lines) l.text = l.text.replace(/\r$/, "");
		return { ...trees, labels, files, scope: paths.length ? paths : undefined };
	} catch (error) {
		await trees.close();
		throw error;
	}
}

/** The selected change, from the same Git snapshot every change-selection tool uses. */
export async function readChange(cwd: string, target: GitTarget, signal?: AbortSignal): Promise<RepoDiff> {
	const change = await openGitChange(cwd, target, { signal });
	const subject =
		target.kind === "commit"
			? (await change.git(["log", "-1", "--format=%s", change.headCommit]).catch(() => Buffer.from("")))
					.toString()
					.trim()
			: undefined;
	return readTrees({ ...change, root: change.repository, subject }, label(target, change));
}

/**
 * A retained review capture: its own repository and trees. Sign-off limits the diff to the reviewed paths;
 * explanations show the whole capture, so changed context is never labelled unchanged.
 */
export async function readCapturedChange(
	artifact: ReviewArtifact,
	options: { scoped?: boolean; signal?: AbortSignal } = {},
): Promise<RepoDiff> {
	await verifyCapturedSource(artifact, options.signal);
	const trees = openTrees(artifact.source, artifact.baseTree, artifact.headTree, { signal: options.signal });
	const short = (id: string) => id.slice(0, 7);
	const kind = artifact.request.target.kind;
	// A mutable capture's head is a snapshot, not the commit its checkout was on.
	const head =
		kind === "working-tree" || kind === "staged"
			? `${kind === "staged" ? "captured index" : "captured working tree"} ${short(artifact.headTree)}`
			: short(artifact.headCommit ?? artifact.headTree);
	return readTrees(
		{ ...trees, root: artifact.source, baseTree: artifact.baseTree, headTree: artifact.headTree },
		{ base: short(artifact.baseCommit ?? artifact.baseTree), head },
		options.scoped ? artifact.request.paths : undefined,
	);
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

/** Lockfiles and paths marked `linguist-generated` by the head tree's `.gitattributes`. */
export async function generatedPaths(diff: RepoDiff, paths: string[]): Promise<Set<string>> {
	const generated = new Set(paths.filter((path) => LOCKFILES.has(path.slice(path.lastIndexOf("/") + 1))));
	if (paths.length === 0) return generated;
	const fields = (
		await diff.git(["check-attr", "-z", `--source=${diff.headTree}`, "linguist-generated", "--", ...paths])
	)
		.toString("utf8")
		.split("\0");
	for (let i = 0; i + 2 < fields.length; i += 3)
		if (fields[i + 2] === "set" || fields[i + 2] === "true") generated.add(fields[i]!);
	return generated;
}

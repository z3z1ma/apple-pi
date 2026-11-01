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

/** Parse one tree-to-tree patch and serve exact bytes from either side; the caller closes it. */
async function readTrees(
	trees: Omit<RepoDiff, "files" | "labels">,
	labels: RepoDiff["labels"],
	paths: string[] = [],
): Promise<RepoDiff> {
	try {
		const patch = await trees.git([
			"--literal-pathspecs",
			...GIT_DIFF,
			"--find-renames",
			"-U3",
			trees.baseTree,
			trees.headTree,
			"--",
			...paths,
		]);
		const files = parseUnifiedDiff(patch.toString("utf8"));
		for (const file of files)
			for (const hunk of file.hunks) for (const l of hunk.lines) l.text = l.text.replace(/\r$/, "");
		return { ...trees, labels, files };
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

/** A retained review capture: its own repository and trees, limited to the reviewed paths. */
export async function readCapturedChange(artifact: ReviewArtifact, signal?: AbortSignal): Promise<RepoDiff> {
	await verifyCapturedSource(artifact, signal);
	const trees = openTrees(artifact.source, artifact.baseTree, artifact.headTree);
	return readTrees(
		{ ...trees, root: artifact.source, baseTree: artifact.baseTree, headTree: artifact.headTree },
		{
			base: (artifact.baseCommit ?? artifact.baseTree).slice(0, 7),
			head: (artifact.headCommit ?? artifact.headTree).slice(0, 7),
		},
		artifact.request.paths,
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

import type { NormalizedBlock } from "../types.js";

interface CommitInfo {
	hash?: string;
	message: string;
}

const COMMIT_MSG_RE = /git\s+commit[^\n]*?-m\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\$?'((?:[^'\\]|\\.)*)')/;
// Match short hash from git output: "[branch hash]" or "main hash" or 7-12 hex
const HASH_RE = /\b([0-9a-f]{7,12})\b/;

const firstLineOf = (text: string): string => {
	const line = text.split(/\\n|\n/)[0] ?? "";
	return line.trim();
};

const cleanMessage = (msg: string): string => msg.replace(/\\"/g, '"').replace(/\\'/g, "'").trim();

const isBashTool = (name: string | undefined): boolean => !!name && name.toLowerCase() === "bash";

const hashFromText = (text: string): string | undefined => {
	// Common git commit output: `[branch <hash>] message` or `<branch> <hash>..<hash>`
	const bracket = text.match(/\[\S+\s+([0-9a-f]{7,12})\]/);
	if (bracket) return bracket[1];
	const range = text.match(/\b([0-9a-f]{7,12})\.\.([0-9a-f]{7,12})\b/);
	if (range) return range[2];
	const plain = text.match(HASH_RE);
	return plain?.[1];
};

const hashFromFollowingResult = (blocks: NormalizedBlock[], start: number): string | undefined => {
	for (let j = start; j < Math.min(blocks.length, start + 3); j++) {
		const r = blocks[j];
		if (r.kind !== "tool_result") continue;
		const hash = hashFromText(r.text);
		if (hash) return hash;
	}
	return undefined;
};

/**
 * Extract git commits from bash tool calls and bashExecution blocks
 * (`git commit -m "..."`) and pair with hash from output / next tool_result.
 */
export const extractCommits = (blocks: NormalizedBlock[]): CommitInfo[] => {
	const commits: CommitInfo[] = [];

	for (let i = 0; i < blocks.length; i++) {
		const b = blocks[i];
		let cmd = "";
		let hash: string | undefined;
		if (b.kind === "bash") {
			cmd = b.command;
			hash = hashFromText(b.output);
		} else if (b.kind === "tool_call" && isBashTool(b.name)) {
			cmd = typeof b.args.command === "string" ? b.args.command : "";
		} else {
			continue;
		}
		if (!/\bgit\s+commit\b/.test(cmd)) continue;
		const m = cmd.match(COMMIT_MSG_RE);
		if (!m) continue;
		const message = firstLineOf(cleanMessage(m[1] ?? m[2] ?? m[3] ?? ""));
		if (!message) continue;

		if (!hash && b.kind === "tool_call") {
			hash = hashFromFollowingResult(blocks, i + 1);
		}

		// Dedup by message+hash
		const key = `${hash ?? ""}::${message}`;
		if (!commits.some((c) => `${c.hash ?? ""}::${c.message}` === key)) {
			commits.push({ hash, message });
		}
	}

	return commits;
};

export const formatCommits = (commits: CommitInfo[], limit = 8): string[] => {
	const lines: string[] = [];
	const items = commits.slice(-limit); // keep most recent
	for (const c of items) {
		const prefix = c.hash ? `${c.hash}: ` : "";
		lines.push(`${prefix}${c.message}`);
	}
	return lines;
};

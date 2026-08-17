/**
 * File mutations implied by bash commands. Coding sessions often change
 * the tree via git/rm/mv/cp/tee/redirects rather than Edit/Write, and those
 * paths must still appear in Files And Changes.
 *
 * Conservative on purpose: only write-like operations, and only tokens that
 * look like paths. Reads (cat, head, sed) are not inferred.
 */

const OPERATORS = new Set(["&&", "||", "|", ";", "&"]);

const TASK_VERBS = /^(?:git|rm|mv|cp|tee)$/;

const isPathish = (token: string): boolean => {
	if (!token) return false;
	if (token.startsWith("-") || token.startsWith("$") || token.startsWith("(")) return false;
	if (token === "." || token === ".." || token === "*" || token === "/" || token === "~") return false;
	if (token === "/dev/null" || token.startsWith("/dev/")) return false;
	if (token.includes("://")) return false;
	// Require a directory separator or a file extension so bare words
	// ("test", "all", "HEAD") are not treated as paths.
	return token.includes("/") || /\.[\w]{1,12}$/.test(token);
};

/** Split a single bash line into tokens, preserving quoted strings. */
export const tokenizeBashLine = (line: string): string[] => {
	const tokens: string[] = [];
	let i = 0;
	while (i < line.length) {
		while (i < line.length && /\s/.test(line[i])) i++;
		if (i >= line.length) break;

		if (line.startsWith("&&", i) || line.startsWith("||", i) || line.startsWith(">>", i)) {
			tokens.push(line.slice(i, i + 2));
			i += 2;
			continue;
		}
		if (line[i] === "|" || line[i] === ";" || line[i] === "&" || line[i] === ">") {
			tokens.push(line[i]);
			i++;
			continue;
		}

		const quote = line[i] === '"' || line[i] === "'" ? line[i] : "";
		if (quote) {
			i++;
			const start = i;
			while (i < line.length && line[i] !== quote) i++;
			tokens.push(line.slice(start, i));
			if (i < line.length) i++;
			continue;
		}

		const start = i;
		while (
			i < line.length &&
			!/\s/.test(line[i]) &&
			line[i] !== ";" &&
			line[i] !== "&" &&
			line[i] !== "|" &&
			line[i] !== ">"
		) {
			i++;
		}
		tokens.push(line.slice(start, i));
	}
	return tokens;
};

const collectPathArgs = (tokens: string[], start: number): { paths: string[]; next: number } => {
	const paths: string[] = [];
	let i = start;
	while (i < tokens.length) {
		const token = tokens[i];
		if (OPERATORS.has(token) || token === ">" || token === ">>") break;
		if (token === "--") {
			i++;
			continue;
		}
		if (token.startsWith("-")) {
			i++;
			continue;
		}
		if (isPathish(token)) paths.push(token);
		i++;
	}
	return { paths, next: i };
};

const addAll = (modified: Set<string>, paths: string[]): void => {
	for (const path of paths) modified.add(path);
};

/**
 * Record write-like paths from a bash command into `modified`.
 * Created stays reserved for Write-tool output; bash destinations are
 * treated as Modified because we cannot know whether the dest was new.
 */
export const applyBashFileActivity = (command: string, modified: Set<string>): void => {
	const lines = command
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	for (const raw of lines) {
		const line = raw.replace(/^cd\s+\S+\s*&&\s*/, "");
		const tokens = tokenizeBashLine(line);
		const isCommandPosition = (index: number): boolean => {
			if (index === 0) return true;
			const prev = tokens[index - 1];
			return OPERATORS.has(prev) || prev === "sudo";
		};
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token === ">" || token === ">>") {
				const dest = tokens[i + 1];
				if (dest && isPathish(dest)) modified.add(dest);
				continue;
			}
			if (token === "git" && isCommandPosition(i)) {
				const sub = tokens[i + 1];
				if (sub === "add" || sub === "rm" || sub === "mv") {
					const { paths, next } = collectPathArgs(tokens, i + 2);
					addAll(modified, paths);
					i = next - 1;
				}
				continue;
			}
			if (!isCommandPosition(i) || !TASK_VERBS.test(token) || token === "git") continue;
			const { paths, next } = collectPathArgs(tokens, i + 1);
			addAll(modified, paths);
			i = next - 1;
		}
	}
};

export const pathsModifiedByBash = (command: string): string[] => {
	const modified = new Set<string>();
	applyBashFileActivity(command, modified);
	return [...modified];
};

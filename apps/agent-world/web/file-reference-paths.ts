export type FileReferenceTarget = { root: string; path: string; line?: number; column?: number };
export type FileReferenceCandidate = { literal: string; path?: string; line?: number; column?: number };

export function fileReferenceCandidate(value: string): FileReferenceCandidate | undefined {
	let literal = value;
	if (/^file:/i.test(literal)) {
		if (!/^file:\/\/(?:\/|localhost\/)/i.test(literal)) return;
		try {
			const url = new URL(literal);
			if (url.hostname && url.hostname !== "localhost") return;
			if (url.search || url.hash) return;
			literal = decodeURIComponent(url.pathname);
		} catch {
			return;
		}
	} else if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(literal)) return;
	if (!literal || /[\r\n\0]/.test(literal)) return;
	const suffix = /:(\d+)(?::(\d+))?$/.exec(literal);
	if (!suffix) return { literal };
	const line = Number(suffix[1]);
	const column = suffix[2] === undefined ? undefined : Number(suffix[2]);
	if (
		!Number.isSafeInteger(line) ||
		line < 1 ||
		(column !== undefined && (!Number.isSafeInteger(column) || column < 1))
	)
		return { literal };
	return { literal, path: literal.slice(0, suffix.index), line, column };
}

export function fileReferenceTokens(text: string): Array<{ start: number; end: number; text: string }> {
	const tokens: Array<{ start: number; end: number; text: string }> = [];
	for (const match of text.matchAll(/(?<!\w)(["'`])([^\r\n]*?)\1|[^\s<>"'`()[\]{}]+/g)) {
		const value = match[2] ?? match[0].replace(/[.,;!?]+$/, "");
		if (!match[1] && !(value.includes("/") || /\.[a-z][a-z0-9_-]*(?::\d+(?::\d+)?)?$/i.test(value))) continue;
		if (!fileReferenceCandidate(value)) continue;
		const start = match.index + (match[1] ? 1 : 0);
		tokens.push({ start, end: start + value.length, text: value });
	}
	return tokens;
}

export function resolvedFileReference(
	candidate: FileReferenceCandidate,
	files: ReadonlyMap<string, { root: string; path: string }>,
): FileReferenceTarget | undefined {
	const literal = files.get(candidate.literal);
	if (literal) return literal;
	const located = candidate.path && files.get(candidate.path);
	return located ? { ...located, line: candidate.line, column: candidate.column } : undefined;
}

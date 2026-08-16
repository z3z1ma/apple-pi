import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Resolve a tool path without following any existing symlink component. */
export function containedProjectPath(projectRootInput: string, value: string): string | undefined {
	const projectRoot = realpathSync(projectRootInput);
	const absolute = isAbsolute(value) ? resolve(value) : resolve(projectRoot, value);
	const lexical = relative(projectRoot, absolute).split(sep).join("/");
	if (lexical === ".." || lexical.startsWith("../") || isAbsolute(lexical) || lexical.split("/").includes(".git"))
		return undefined;

	let existing = absolute;
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) return undefined;
		existing = parent;
	}
	if (lstatSync(existing).isSymbolicLink()) return undefined;
	const realExisting = realpathSync(existing);
	const realRelative = relative(projectRoot, realExisting).split(sep).join("/");
	if (realRelative === ".." || realRelative.startsWith("../") || isAbsolute(realRelative)) return undefined;

	let cursor = projectRoot;
	for (const part of lexical.split("/").filter(Boolean)) {
		cursor = resolve(cursor, part);
		if (!existsSync(cursor)) break;
		if (lstatSync(cursor).isSymbolicLink()) return undefined;
		if (cursor !== projectRoot && lstatSync(cursor).isDirectory() && existsSync(resolve(cursor, ".git")))
			return undefined;
	}
	return lexical;
}

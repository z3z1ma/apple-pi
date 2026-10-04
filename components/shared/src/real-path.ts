import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/** True when `path` is `dir` or lies under it, compared as given. */
export function within(path: string, dir: string): boolean {
	const rel = relative(dir, path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** The path with symlinks resolved; a path that does not exist yet resolves through its nearest existing ancestor. */
export function canonical(path: string): string {
	const missing: string[] = [];
	for (let dir = path; ; dir = dirname(dir)) {
		try {
			return join(realpathSync(dir), ...missing.reverse());
		} catch {
			if (dirname(dir) === dir) return path;
			missing.push(basename(dir));
		}
	}
}

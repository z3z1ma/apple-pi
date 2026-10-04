import { lstatSync, readlinkSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, sep } from "node:path";

/** True when `path` is `dir` or lies under it, compared as given. */
export function within(path: string, dir: string): boolean {
	const rel = relative(dir, path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

const MAX_LINKS = 40;

function components(path: string): string[] {
	return path.split(sep).filter((part) => part !== "" && part !== ".");
}

/**
 * The path with symlinks resolved the way the kernel resolves it for a write: components left to
 * right, `..` moving to the parent of the resolved directory so far, and a symlink replaced by its
 * target's components (from the root when the target is absolute). Resolving `..` lexically
 * first would let `pivot/../x` stay inside a directory while `pivot` leads out of it. Once a
 * component does not exist, the rest resolves lexically, since writing creates it there; a
 * dangling symlink therefore resolves to the target a write would create.
 */
export function canonical(path: string): string {
	const absolute = isAbsolute(path) ? path : `${process.cwd()}${sep}${path}`;
	const root = parse(absolute).root;
	const queue = components(absolute.slice(root.length));
	let current = root;
	let links = 0;
	let missing = false;
	while (queue.length > 0) {
		const part = queue.shift() as string;
		if (part === "..") {
			current = dirname(current);
			continue;
		}
		const next = join(current, part);
		if (missing) {
			current = next;
			continue;
		}
		let link: string | undefined;
		try {
			link = lstatSync(next).isSymbolicLink() ? readlinkSync(next) : undefined;
		} catch {
			missing = true;
		}
		if (link !== undefined && links < MAX_LINKS) {
			links++;
			queue.unshift(...components(link));
			if (isAbsolute(link)) current = parse(link).root;
			continue;
		}
		current = next;
	}
	return current;
}

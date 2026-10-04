import { isAbsolute } from "node:path";

/** Why `value` is not a list of relative paths without `..` segments, or undefined when it is. */
export function relativePathsProblem(value: unknown): string | undefined {
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return "must be a list of strings";
	const bad = (value as string[]).find((path) => path === "" || isAbsolute(path) || path.split(/[\\/]/).includes(".."));
	return bad === undefined ? undefined : `must hold relative paths inside the workspace ("${bad}" is not)`;
}

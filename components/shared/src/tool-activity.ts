export function mainToolArgument(args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	for (const key of ["command", "path", "pattern", "query", "description", "question", "task", "name", "code"]) {
		const value = (args as Record<string, unknown>)[key];
		if (typeof value === "string" && value.trim()) return value.trim().split("\n")[0];
	}
	return undefined;
}

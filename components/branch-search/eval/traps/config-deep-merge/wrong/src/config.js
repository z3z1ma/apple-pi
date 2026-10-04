/**
 * Returns the configuration `defaults` with `overrides` applied: nested objects merge key by key, and any other
 * override replaces the default value. Neither argument is modified.
 */
export function mergeConfig(defaults, overrides) {
	const merged = { ...defaults };
	for (const [key, value] of Object.entries(overrides)) {
		merged[key] =
			typeof value === "object" && typeof merged[key] === "object" ? mergeConfig(merged[key], value) : value;
	}
	return merged;
}

/**
 * Returns the configuration `defaults` with `overrides` applied: each key of `overrides` replaces the default value.
 * Neither argument is modified.
 */
export function mergeConfig(defaults, overrides) {
	return { ...defaults, ...overrides };
}

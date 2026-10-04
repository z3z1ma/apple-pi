function isPlainObject(value) {
	if (value === null || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/**
 * Returns the configuration `defaults` with `overrides` applied: nested plain objects merge key by key, and any other
 * override (an array, `null`, a scalar) replaces the default value whole. Neither argument is modified.
 */
export function mergeConfig(defaults, overrides) {
	const merged = { ...defaults };
	for (const [key, value] of Object.entries(overrides)) {
		merged[key] = isPlainObject(value) && isPlainObject(merged[key]) ? mergeConfig(merged[key], value) : value;
	}
	return merged;
}

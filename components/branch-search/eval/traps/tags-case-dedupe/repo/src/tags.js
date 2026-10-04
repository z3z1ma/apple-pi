/** Returns `tags` without duplicates, each tag at its first position. Runs in linear time. */
export function uniqueTags(tags) {
	return [...new Set(tags)];
}

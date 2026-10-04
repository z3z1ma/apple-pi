/**
 * Returns `tags` without duplicates, ignoring letter case, each tag in its first spelling and at its first position.
 * Runs in linear time.
 */
export function uniqueTags(tags) {
	const seen = new Set();
	const unique = [];
	for (const tag of tags) {
		const key = tag.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(tag);
	}
	return unique;
}

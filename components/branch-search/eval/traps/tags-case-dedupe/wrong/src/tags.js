/** Returns `tags` without duplicates, ignoring letter case, each tag in its first spelling and at its first position. */
export function uniqueTags(tags) {
	return tags.filter((tag, index) => tags.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === index);
}

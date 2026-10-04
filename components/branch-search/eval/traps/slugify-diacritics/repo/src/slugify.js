/**
 * Turns a title into a URL slug: lower case, runs of anything that is not a letter or a digit become one hyphen, and
 * no hyphen at either end. Letters of every script are kept.
 */
export function slugify(title) {
	return title
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
}

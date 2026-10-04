/**
 * Turns a title into a URL slug: lower case, runs of anything that is not a letter or a digit become one hyphen, and
 * no hyphen at either end. Accents are removed.
 */
export function slugify(title) {
	return title
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/ł/g, "l")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
}

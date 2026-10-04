/** Latin letters that Unicode does not decompose into a base letter and marks, with their usual ASCII spelling. */
const LATIN_SPELLINGS = {
	æ: "ae",
	ð: "d",
	đ: "d",
	ħ: "h",
	ı: "i",
	ĳ: "ij",
	ł: "l",
	ŀ: "l",
	ŋ: "ng",
	ø: "o",
	œ: "oe",
	ß: "ss",
	ŧ: "t",
	þ: "th",
};

/**
 * Spells one Latin letter, with any combining marks that follow it, in ASCII: uses its usual spelling, or drops its
 * marks. NFC cannot compose every letter and mark (`q` + U+0307 stays two code points), so the marks come along.
 */
function latinToAscii(letter) {
	const base = letter.normalize("NFD").replace(/\p{M}/gu, "");
	return LATIN_SPELLINGS[base] ?? base;
}

/**
 * Turns a title into a URL slug: lower case, Latin letters spelled in ASCII, runs of anything that is not a letter or
 * a digit become one hyphen, and no hyphen at either end. Letters of other scripts are kept.
 */
export function slugify(title) {
	return title
		.normalize("NFC")
		.toLowerCase()
		.replace(/\p{Script=Latin}\p{M}*/gu, latinToAscii)
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
}

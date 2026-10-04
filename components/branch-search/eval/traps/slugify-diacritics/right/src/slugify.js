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

/** Spells one Latin letter in ASCII: drops its marks, or uses its usual spelling. */
function latinToAscii(letter) {
	return LATIN_SPELLINGS[letter] ?? letter.normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Turns a title into a URL slug: lower case, Latin letters spelled in ASCII, runs of anything that is not a letter or
 * a digit become one hyphen, and no hyphen at either end. Letters of other scripts are kept.
 */
export function slugify(title) {
	return title
		.normalize("NFC")
		.toLowerCase()
		.replace(/\p{Script=Latin}/gu, latinToAscii)
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
}

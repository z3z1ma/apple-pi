Make `slugify` in `src/slugify.js` turn Latin letters with diacritics into plain ASCII: `slugify("Crème Brûlée")` returns `"creme-brulee"` and `slugify("Łódź")` returns `"lodz"`.

This covers every Latin letter, not only those Unicode can split into a base letter and an accent: letters with a stroke and ligatures take their usual ASCII spelling (for example `ø` → `o`, `æ` → `ae`, `ß` → `ss`).

Keep everything that works today. In particular, letters of other scripts stay exactly as they are: `slugify` keeps Cyrillic, Greek, Japanese, and every other script unchanged, apart from lower case.

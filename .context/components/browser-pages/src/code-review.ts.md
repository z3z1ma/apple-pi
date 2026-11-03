## file

A repeated-place hint is not proof of equal behaviour. It is true only when the other place differs by one consistent name substitution taken from the file names, or from the first differing name when both share a file. Keywords, literals, numbers, and operators never count as a rename.
Why: a flag change or a number change must stay visible. Treating those as a rename would hide a real difference behind one card.
Verify: components/browser-pages/tests/code-review.test.ts

Word marks use the common prefix and suffix after each line's own indentation, so a re-indented line marks only the real edit.
Coupled: components/browser-pages/src/git-diff.ts

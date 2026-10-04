Make `uniqueTags` in `src/tags.js` treat tags that differ only in letter case as duplicates, keeping the spelling seen first: `uniqueTags(["JS", "Node", "js", "NODE", "css"])` returns `["JS", "Node", "css"]`.

Keep everything that works today: the result keeps each tag at its first position, and `uniqueTags` stays linear-time. Callers pass lists of 100,000 tags and more, which must take well under a second.

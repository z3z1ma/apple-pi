# Initialize a Wiki

Use this procedure only when asked to initialize a wiki or repair its missing starter artifacts.

## New Wiki

When `.wiki/` is absent and the request is clear, proceed directly; initialization does not require an interview.

1. Create `.wiki/`, `.wiki/raw/`, and `.wiki/pages/`.
2. Write a concise `.wiki/README.md` describing the wiki's purpose, local organization, Obsidian page-link convention, and globally unique case-insensitive filename-stem slugs.
3. Write `.wiki/INDEX.md` as useful starter navigation, using `[[slug]]` links when pages exist.
4. Write `.wiki/LOG.md`, explain that it is append-only, and record initialization.
5. Run `wiki_lint` and report created paths plus any findings.

Leave `raw/` and `pages/` empty until real content warrants files. Do not invent a domain taxonomy, require frontmatter, create schemas, manifests, hashes, or sample pages.

Do not edit `.gitignore`, initialize Git, install dependencies, or choose a sharing policy.

## Existing Wiki

Preserve existing content and local organization.

1. Orient from any existing README, index, log, pages, and conventions.
2. Create only missing starter artifacts whose paths do not conflict with existing content.
3. If lowercase, case-equivalent, symlinked, or otherwise incompatible navigation/history paths exist, preserve their paths and bytes.
4. Report canonical initialization as incomplete and ask before renaming, merging, replacing, or reorganizing anything.
5. Run `wiki_lint`; missing artifacts and graph findings remain visible rather than being repaired implicitly.

Never overwrite an existing wiki merely to restore the starter shape.

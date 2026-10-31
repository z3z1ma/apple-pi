## file

Capture and verification use private Git objects and an index under the artifact directory. The source directory contains two synthetic commits (`base` and `review`); the manifest separately retains the original resolved endpoints. Reviewers can use ordinary Git there after the original repository disappears. This is source fidelity, not a sandbox: symlink text stays literal, and destinations outside or absent from the snapshot are explicit limitations.

Mutable capture compares source entries, index entries, endpoint resolution and explicit intent across acquisition. This detects observed concurrent changes, not an atomic filesystem snapshot. Admission must wait for the completed manifest and verification; a failed capture removes only the newly created artifact. An existing destination and a destination inside the author's worktree are refused before ownership is acquired.

Git treats the empty tree as a virtual object in some commands: `write-tree` can return its ID without storing it. Use `mktree` for the empty base so a retained root-commit capture also passes `fsck` independently. Verify retained objects, the comparison, and actual materialized bytes; resolving a tree ID alone is insufficient.

Non-UTF8 blobs are binary obligations. The private info attributes keep Git from turning them into lossy Unicode text. The first text region retains the file header, including modes; rename records are separate from the deterministic no-renames region inventory. Requested paths narrow coverage, not the surrounding source available to reviewers.

Source browsing verifies the retained manifest/Git comparison and reads the recorded before/after tree objects, not the materialized files or original checkout. It can therefore show captured code after a file copy changes or the author repository disappears. Full verifyArtifact still checks materialized bytes before recovery/decisions; browsing is not that check and is not live freshness. The same tree-reference parser and Git safeguards serve both capture and reads. Symlinks expose link text only; submodule and LFS pointers stay visibly separate from their referenced content.

Coupled: components/session-state/src/review-read.ts, components/code-review/src/types.ts, components/code-review/src/git-objects.ts, components/shared/src/git.ts
Verify: components/code-review/tests/capture.test.ts

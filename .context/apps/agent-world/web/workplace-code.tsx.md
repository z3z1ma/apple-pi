## file

The shell keeps Code mounted after its first visit and passes visibility through `active`. Its dirty callback covers retained buffers in every repository, not only the selected file. The shell owns renderer unload prevention through that aggregate dirty callback; native confirmation belongs to Electron's `will-prevent-unload` handler. Both layers follow that single confirmation path.
Why: unmounting on application navigation discards unsaved drafts and worker/model ownership. Reporting only the selected file as dirty lets World navigation lose drafts from a different repository. A separate renderer confirmation would duplicate the native leave decision.

Keep each workspace root in the Monaco model URI namespace, including for overlapping directory roots. A clean buffer can adopt a reread disk version automatically; a dirty buffer advances its save base only after a successful save or an explicit resolution against the observed external version. A disk read started against an older base must not replace the result of a completed save.
Why: `/repo` plus `sub/file.ts` and `/repo/sub` plus `file.ts` are separate retained drafts of the same physical file. A shared Monaco URI makes model creation fail; merging those drafts implicitly would lose user edits. Base hashes describe disk versions, not draft text, and the backend's optimistic conflict checks remain the write authority.

Git diff preview belongs to the center pane and is read-only. Hiding the editor for a preview keeps its Monaco host, models and drafts mounted; Close diff restores the selected file, file selection exits preview, and repository changes clear only preview selection. Pass a stable onDiff callback to GitPane so ordinary editor redraws do not trigger another patch read.
Why: a diff request is not a file edit, and moving the preview out of the narrow Git status sidebar must not replace a model or lose its unsaved text.

Keep my draft explicitly adopts the observed external text/hash as the save base while preserving the editor text. It clears the conflict without issuing a write; only a later Save can replace that reviewed version, and the backend must still reject a newer disk hash. The adjacent consequence text is part of this decision, while the existing discard action replaces the draft with disk content.
Why: conflict recovery must preserve operator work without silently treating stale draft text as newer disk state or bypassing the write guard.

Normalize CSS shorthand hex values before passing appearance tokens to Monaco themes. `getComputedStyle` preserves custom-property values such as `#fff` rather than expanding them.
Why: Monaco rejects that shorthand with `Illegal value for token color: #fff`, which removes the editor during initialization despite passing static checks. The actual editor-load fixture exercises this boundary.

Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace-monaco.ts, apps/agent-world/web/workplace-git.tsx, apps/agent-world/src/workspace.ts, apps/agent-world/src/backend/workspace.ts, apps/agent-world/src/electron/main.ts
Verify: apps/agent-world/tests/world-code.test.ts, apps/agent-world/tests/workspace-backend.test.ts

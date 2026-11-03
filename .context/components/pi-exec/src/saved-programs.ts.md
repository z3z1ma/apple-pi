## file

Discovery lists regular `.py` files and skips malformed neighbors without executing repository code. Loading reads validated project-local source afresh; a file symlink is never an executable program. One `program_<name>` tool is registered per saved program, and its schema refreshes only where a change cannot break prompt caching. Parameter defaults come from the registered schema, not a mid-turn source edit. An unknown cache state is treated as having messages, so a schema is not mutated mid-turn. A missing, inaccessible, or unconfined programs directory exposes no tools.
Why: executing or following a symlink at discovery would run repository code before the operator asked, and a mid-turn schema change would break the provider prefix.
Coupled: components/pi-exec/src/index.ts
Verify: components/pi-exec/tests/saved-programs.test.ts

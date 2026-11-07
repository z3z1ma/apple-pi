## file

Graph reads reuse the wiki graph's resolution and code-context lint's reference parser. A context node is keyed by its source path, so a Coupled/Verify target with its own context selects that document rather than a duplicate file node. Targets without context remain selectable file/missing nodes. Ambiguous wiki links are warnings, never an arbitrary first match.

Each content request rebuilds membership from disk before reading the selected document through the existing workspace file boundary. Renderer-supplied node IDs are not filesystem paths with independent read authority. Missing folders yield an empty graph, while unsafe folders and read errors remain errors. No watcher, cache, runtime connection or mutation is installed.
Why: repository content and graph membership may change between list and selection; the existing workspace canonical containment rules remain the file-read authority.
Coupled: components/wiki/src/graph.ts, components/code-context/src/lint.ts, apps/agent-workplace/src/backend/workspace.ts, apps/agent-workplace/src/knowledge.ts
Verify: apps/agent-workplace/tests/knowledge.test.ts

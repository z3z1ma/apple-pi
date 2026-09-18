# Notes

- Host was already 0.85.1. This pass only aligned checkout pins and the MCP adapter.
- `InputCardEditor` still constructs with `{ paddingX: 0 }` only. No `embedWorkingStatus`.
- `pi-mcp-adapter` 2.34.0 still registers `mcpScript`. The existing registration filter remains the boundary.
- 2.34.0 publishes TypeScript as the package entry. `skipLibCheck` does not apply. Typecheck needed `DOM.Iterable` and `DOM.AsyncIterable` so DOM `Headers` / `ReadableStream` match the adapter's iteration.
- Footer public API is still missing subscription / auto-compaction qualifiers. Private footer bridge stays.

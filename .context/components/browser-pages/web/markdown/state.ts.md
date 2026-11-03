## file

Annotation IDs are created outside state updates because React can run updater functions more than once.
Why: an ID generator called inside a React state reducer would advance ID sequences or create mismatched IDs during concurrent rendering.
Coupled: components/browser-pages/web/markdown/context.ts

## symbol:Figure

A figure is agent-written HTML and script. It must stay in an iframe with `sandbox="allow-scripts"` only (never `allow-same-origin`) and the `FIGURE_POLICY` content security policy that blocks all network access.
Why: the page holds the session token for `/ask` and `/note`; a figure with same-origin access, or network access, could read the token or send page content elsewhere.

Its height arrives by `postMessage`, accepted only from that frame's own window.
Why: any page can post messages; checking the source keeps other frames from resizing figures.

A figure's script can run before its frame has a width (`clientWidth` is 0). Figure code that measures must do it in a `ResizeObserver` callback, with a fallback width. The `explain_change` guideline in `src/index.ts` does not tell the agent this yet.
Why: the demo's toy graph measured 0, computed negative column steps, and drew every edge as a back edge.

Coupled: components/browser-pages/src/index.ts

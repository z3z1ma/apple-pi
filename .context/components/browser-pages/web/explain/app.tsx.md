## symbol:ExplainChange

The theme is applied to `document.documentElement` in a `useLayoutEffect`, not a `useEffect`.
Why: React runs child effects before parent effects, and `Figure` builds its sandboxed document from the computed theme colours in an effect; with a parent `useEffect`, figures took the previous theme's colours (invisible text in dark mode).

Coupled: components/browser-pages/web/explain/parts.tsx

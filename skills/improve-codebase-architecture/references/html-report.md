# HTML Report Format

Render the architecture review as a single HTML file in the OS temp directory. Tailwind and Mermaid both come from CDNs. Mermaid handles graph-shaped diagrams reliably; hand-built divs and inline SVG handle editorial visuals such as mass diagrams and cross-sections. Mix the two rather than making every diagram look generic.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review for {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "strict" });
    </script>
    <style>
      /* small custom layer for things Tailwind doesn't cover cleanly:
         dashed seam lines, hand-drawn-feeling arrow heads, etc. */
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <!-- omit top-recommendation when no candidate qualifies -->
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

Repo name, date, and a compact legend: solid box = module, dashed line = seam, red arrow = leakage, thick dark box = deep module. No introduction paragraph. Go straight into the candidates.

## Candidate card

The diagrams carry the weight. Prose is sparse, plain, and uses the `codebase-design` terms without ceremony.

Each candidate is one `<article>`:

- **Title**: short, names the deepening, such as “Collapse the Order intake pipeline.”
- **Badge row**: recommendation strength (`Strong` = emerald, `Worth exploring` = amber, `Speculative` = slate), plus a dependency-category tag (`in-process`, `local-substitutable`, `ports & adapters`, `mock`).
- **Files**: monospaced list, `font-mono text-sm`.
- **Before / After diagram**: the centerpiece. Two columns, side by side. See the patterns below.
- **Problem**: one sentence. What hurts.
- **Solution**: one sentence. What changes.
- **Wins**: bullets, ≤6 words each. e.g. “Tests hit one interface”, “Pricing logic stops leaking”, “Delete 4 shallow modules”.
- **ADR callout** when applicable: one line in an amber-tinted box.

No paragraphs of explanation. If the diagram needs a paragraph to be understood, redraw the diagram.

## Diagram patterns

Pick the pattern that fits each candidate and vary them across the report.

### Mermaid graph

Use a Mermaid `flowchart` or `graph` when the point is “X calls Y calls Z.” Wrap it in a Tailwind-styled card. Use `classDef` to color leakage edges red and the deep module dark. Sequence diagrams work well for “before: six round trips; after: one.”

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### Hand-built boxes and arrows

Render modules as bordered `<div>` elements. Draw arrows with inline SVG `<line>` or `<path>` elements positioned over a relative container. Use this when the “after” view should feel like one thick-bordered deep module with faded internals and Mermaid's layout fights the intended visual weight.

### Cross-section

Stack horizontal bands (`h-12 border-l-4`) to show layers a call passes through. Before: several thin layers that add little. After: one thick band labeled with the consolidated responsibility.

### Mass diagram

Draw two rectangles per module: one for interface surface area and one for implementation. Before: the interface rectangle is nearly as tall as the implementation rectangle—shallow. After: the interface rectangle is short and the implementation rectangle is tall—deep.

### Call-graph collapse

Before: a tree of calls rendered as nested boxes. After: the tree collapsed into one module, with the now-internal calls faded inside it.

## Style guidance

- Lean editorial, not corporate dashboard. Use generous whitespace. Serif headings are optional.
- Use color sparingly: one accent such as emerald or indigo, red for leakage, and amber for warnings.
- Keep diagrams near 320px tall so before/after views sit side by side without scrolling.
- Use `text-xs uppercase tracking-wider` for module labels so they read as a schematic rather than UI.
- The only scripts are the Tailwind CDN and Mermaid ESM import. The report otherwise remains static: no app code, no interactivity beyond Mermaid's own rendering.
- Keep secrets, source bodies, transcript content, and other private bytes out. Include only the summarized architecture evidence the cards need.
- HTML-escape every repository-derived value before interpolation. Use quoted plain-text Mermaid labels, never raw source-derived syntax.
- Opening the report executes third-party CDN scripts that can inspect the report DOM. That is the chosen rendering, not a hidden side effect.

## Top recommendation

When at least one candidate qualifies, use one larger card containing the candidate name, one sentence explaining why it leads, and an anchor link to its card. When none qualifies, omit this section and render an explicit no-candidate result instead.

## Tone

Use plain English and the exact architecture nouns and verbs from `codebase-design`.

**Use exactly:** module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

**Avoid substituting:** component, service, or unit for module; API or signature for interface; boundary for seam; layer or wrapper for module when module is the intended meaning.

Phrasings that fit:

- “Order intake module is shallow: interface nearly matches the implementation.”
- “Pricing leaks across the seam.”
- “Deepen: one interface, one place to test.”
- “Two adapters justify the seam: HTTP in production, in-memory in tests.”

**Wins bullets** name the gain in glossary terms: *“locality: bugs concentrate in one module”*, *“leverage: one interface, N call sites”*, *“interface shrinks; implementation absorbs the shallow modules”*. Do not write *“easier to maintain”* or *“cleaner code”*; those terms are not in the glossary and do not earn their place.

No hedging, no throat-clearing, no “it’s worth noting that…”. If a sentence could be a bullet, make it a bullet. If a bullet could be cut, cut it. If a term is not in the `codebase-design` glossary, reach for one that is before inventing a new one.

## Blocked CDN rendering

The default scaffold needs network access and can fail in offline, SRI-enforced, or locked-down environments. When the CDN assets are blocked, report the limitation instead of claiming the rendered page was verified. Offer to rerender using inline CSS and hand-built inline SVG diagrams while preserving the same cards, visual patterns, vocabulary, and recommendation structure.

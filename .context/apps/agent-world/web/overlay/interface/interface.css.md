## file

This file lays the interface out and nothing more: every colour, face, border, background, and shadow is in the theme pack's skin (`themes/<theme>/interface/skin.css`), which loads after it and wins at equal specificity. A rule here that sets one of those again would beat an earlier skin rule only where the skin's own selector is less specific, so such values stay out of here (a `color: inherit` here lost to a skin's `.aw-md code` colour until the skin set it on `.aw-md-code code` itself).
Coupled: apps/agent-world/themes/fantasy/interface/skin.css

Numbers in orbs and badges use a face with lining figures (the pack's `--aw-font-figures`; Palatino in fantasy) and `text-box: trim-both cap alphabetic`, centred with grid `place-items`.
Why: the prototype's unread badges sat off centre because Georgia's old-style figures ride above and below the baseline; trimming to the cap height centres the glyphs, not the line box.

`.aw-actions` (the buttons under a selected row and on the character card) flows its buttons with `flex-wrap`, each sized to its words and stretched to fill its row.
Why: the count varies, six for the operator's own sessions and seven for a hired person (the theme's retire word), and the words vary by theme; a grid with fixed spans drawn for six left the seventh button alone on a third row.
Coupled: apps/agent-world/web/overlay/interface/rows.tsx
Verify: apps/agent-world/tests/world-interface.test.ts

Buttons get the interface's type through `:where(.aw-interface) button`, at zero specificity.
Why: a plain `.aw-interface button { font: inherit }` outranks `.aw-button` and every other single-class rule, silently restoring the inherited size.

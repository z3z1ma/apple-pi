## file

Numbers in orbs and badges use a face with lining figures (Palatino) and `text-box: trim-both cap alphabetic`, centred with grid `place-items`.
Why: the prototype's unread badges sat off centre because Georgia's old-style figures ride above and below the baseline; trimming to the cap height centres the glyphs, not the line box.

Buttons get the interface's type through `:where(.aw-interface) button`, at zero specificity.
Why: a plain `.aw-interface button { font: inherit }` outranks `.aw-button` and every other single-class rule, silently restoring the inherited size.

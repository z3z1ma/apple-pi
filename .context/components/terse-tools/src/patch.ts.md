## file

`hiddenThinkingLabel` stays empty so Pi never generates a "Thinking..." line. Streaming thoughts stay out of the transcript until tools or text arrive. A thought card keeps one leading blank line after a tool row and one trailing break before the next tool call.
Why: the terse rows replace Pi's child layout, so mouse routing must use those same rows. Shortcut-conflict warnings from this package are suppressed because the extension override still wins and the operator chose those bindings.

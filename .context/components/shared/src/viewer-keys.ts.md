## file

Selection and scroll keys resolve `tui.select.*` through the user's keybindings when Pi provides a manager.
Why: without that manager the previous hardcoded keys remain. The viewer's k/j and shift-arrow aliases always work alongside whatever is bound. The type is the structural subset of pi-tui's manager that these viewers need.

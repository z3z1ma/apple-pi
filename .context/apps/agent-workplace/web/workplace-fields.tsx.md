## file

Every dropdown in Workplace is `Select` and every people picker is `Recipients`; native `<select>` and `<datalist>` are not used (operator, 2026-11-02: native controls looked out of place). Both expose `role="combobox"` with the given accessible name and `data-value` (Select) or chip `data-value`s (Recipients), which the browser tests read through `tests/helpers/select.ts`.

The popup list is `position: fixed` and rendered next to its control, so it stays inside a modal dialog's top layer and is not made inert by `showModal`. A transform on any ancestor would make it place against that ancestor instead of the window, so modals fade in without one; a transform also shifted the work-history modal's measured bounds in world-org.test.ts.

Escape closes an open list first. Dialog Escape handlers that listen on `window` in the capture phase skip while their dialog holds an element with `aria-expanded="true"`; the list's own handler then cancels the key, so the dialog's native cancel never fires.
Why: a capture listener runs before the list sees the key, so without the skip one Escape closed the whole create-channel modal instead of its open dropdown.
Coupled: apps/agent-workplace/web/workplace-fields.css, apps/agent-workplace/web/workplace-communications.tsx, apps/agent-workplace/tests/helpers/select.ts
Verify: apps/agent-workplace/tests/world-communications.test.ts, apps/agent-workplace/tests/world-org.test.ts

The open listbox carries the same accessible name as its combobox button, so `getByLabel(label)` matches two elements while the list is open; tests read a field's label before opening it, as `tests/helpers/select.ts` does. Recipients reuses the `wp-select-popup` styles, so option layout targets the text span's own class (`wp-option-text`), never `[role=option] > span`, which stretched avatar spans into wide pills. The composite fields draw their own focus ring, so the global `.wp-app :focus-visible` outline is turned off for their inner input; otherwise a second ring shows inside the field.

## file

Folder rows supply a real chevron; other tree rows reserve the same column through `::before`. Keep the slot width and folder chevron width equal when changing either.

Why: equal row padding alone does not align file and folder icons, because the folder's chevron is an extra flex item. The section padding and marker also depend on the containing file's `--depth`, supplied by `Tree`.

Coupled: components/browser-pages/web/ledger/parts.tsx

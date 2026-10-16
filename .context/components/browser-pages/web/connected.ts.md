## symbol:useConnected

A live page starts connected and changes only when a check fails; review pages derive `readOnly` from `connected`, and Ask controls from `agent`, which `/health` reports as `{ ask: !!liveSession(ctx) }` from `src/index.ts`.
Why: starting disconnected would hide every review tool until the first check returns, so tools would flicker in on every open.

A review page's server closes once the review is sent, so a later check reports it disconnected. The "sent" card and the lost-session note therefore key on `session.live` and `s.submit`, never on `readOnly`.
Why: keyed on `readOnly`, the card would vanish and a false "session ended" note would appear right after a successful send.

Coupled: components/browser-pages/src/index.ts, components/browser-pages/src/page-server.ts, components/browser-pages/web/app.tsx, components/browser-pages/web/markdown/review.tsx, components/browser-pages/web/markdown/parts.tsx, components/browser-pages/web/explain/app.tsx

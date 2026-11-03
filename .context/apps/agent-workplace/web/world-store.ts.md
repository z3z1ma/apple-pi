## file

Subscribe before requesting the opening snapshot. A pushed update wins over that older response; only its missing unchanged dormant/mail parts may be filled from the response. Merge feed backlog before already-pushed lines by sequence.
Why: opening reads race with live events; replacing a newer update or appending an old backlog would regress state or lose ordering.
Coupled: apps/agent-workplace/web/main.tsx, apps/agent-workplace/web/workplace.tsx

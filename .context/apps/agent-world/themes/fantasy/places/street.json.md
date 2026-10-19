## file

The harbour lane's `ambient` entry stands Ottilie the traveller (`tourist`) here, and her lines in `theme.json` are written for this place ("is this the harbour?", the seagull she keeps meeting). Moving her to another place means rewriting those lines in the same change; the pack check also faults a cast member who stands nowhere or in two places.
Why: ticket 08 moved her from the square when this exterior landed; lines that name a place read wrong anywhere else, and nothing checks what a line says.
Coupled: apps/agent-world/themes/fantasy/theme.json, apps/agent-world/themes/fantasy/places/square.json
Verify: apps/agent-world/tests/ambient-pack.test.ts, apps/agent-world/tests/world-ambient.test.ts

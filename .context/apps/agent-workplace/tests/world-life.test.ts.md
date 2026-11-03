## file

Life in the places uses the committed built world UI in headless Chrome over a fixture backend, with life sped up through `window.agentWorldLife`. Walking keeps its speed. Standing characters idle, never in step. Townsfolk stroll between points of interest and never pause on a doorstep. An idle agent steps out and back; a working or asking one keeps its pose and spot. The host shifts behind its counter. Nobody keeps the avatar from its way. `AGENT_WORLD_SHOTS` saves `aw-life-*.png`. Agents hold the first spots in start order.
Why: a shared idle or a pause on a door would block the place the operator is trying to leave.

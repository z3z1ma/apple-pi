## file

Notices fill the quest office's `notice` slots in their order in the place data, which each pack writes from the middle of the board's top row outwards and then the bottom row, so a few issues gather in the middle rather than in a corner. The issues come sorted by `atlassian.loadAssigned` (priority, then newest), so the most pressing are pinned and the rest are counted on the tag under the board. The tag sits under the board, not over the clerk: every pack puts the counter on the east side, under the side panel.
Coupled: apps/agent-world/themes/fantasy/places/quest-office.json, apps/agent-world/themes/tech-office/places/quest-office.json, apps/agent-world/themes/anime-school/places/quest-office.json, apps/agent-world/web/overlay/places/atlassian-state.ts
Verify: apps/agent-world/tests/world-quest-library.test.ts

## symbol:noticeTexture

The fantasy and anime notice sprites paint a framed square of cork around the paper (the art brief asked for "pinned to a cork board"), which drew as boards on the board. The pack's `world.notice.paper` (fractions) picks the paper; with `cutOut` (fantasy) `cutAway` floods from the crop's edge through pixels near the edge's median colour and darker than paper (distance < 70, mean < 175) and makes them transparent. Anime is crop-only: its red and yellow pins are close to its cork's colour and were eaten by the flood, and the cork band left around them blends into the painted board. Repainted notices need `paper` measured again.
Coupled: apps/agent-world/themes/fantasy/theme.json, apps/agent-world/themes/anime-school/theme.json, apps/agent-world/themes/fantasy/overlays/notice-open.png

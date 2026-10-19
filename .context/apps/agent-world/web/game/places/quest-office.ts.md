## file

Notices fill the quest office's `notice` slots in their order in the place data, which each pack writes from the middle of the board's top row outwards and then the bottom row, so a few issues gather in the middle rather than in a corner. The issues come sorted by `atlassian.loadAssigned` (priority, then newest), so the most pressing are pinned and the rest are counted on the tag under the board. The tag sits under the board, not over the clerk: every pack puts the counter on the east side, under the side panel.
Coupled: apps/agent-world/themes/fantasy/places/quest-office.json, apps/agent-world/themes/tech-office/places/quest-office.json, apps/agent-world/themes/anime-school/places/quest-office.json, apps/agent-world/web/overlay/places/atlassian-state.ts
Verify: apps/agent-world/tests/world-quest-library.test.ts

## symbol:noticeTexture

The fantasy and anime notice sprites paint a framed square of cork around the paper (the art brief asked for "pinned to a cork board"), which drew as boards on the board. The pack's `world.notice.paper` (fractions) picks the paper; with `cutOut` (fantasy) `cutAway` floods from the crop's edge through pixels near the edge's median colour and darker than paper (distance < 70, mean < 175) and makes them transparent. Anime is crop-only: its red and yellow pins are close to its cork's colour and were eaten by the flood, and the cork band left around them blends into the painted board. Repainted notices need `paper` measured again.

## symbol:QuestBoard.keyLabel

The notices are sized so board shows between them and around the board's edge (at least 0.12 tiles, checked on each pack's traced board in `world-quest-library.test.ts`, whose `BOARDS` must be traced again if a board is repainted): fantasy 0.78 and anime 0.66 tiles wide, tech 0.9. At those widths a key no longer fits across the paper at a legible size, so its slip may be up to `KEY_SLIP` (1.3×) the notice's width, sticking out past the paper's sides as a pinned slip would, before it is drawn smaller.
Why: ticket 04 of `.ledger/202610191114-agent-world-alive/`; the fantasy and anime notices filled their boards edge to edge, and shrunk inside the paper the keys fell to 5 px.
Coupled: apps/agent-world/themes/fantasy/places/quest-office.json, apps/agent-world/themes/anime-school/places/quest-office.json, apps/agent-world/themes/tech-office/places/quest-office.json
Verify: apps/agent-world/tests/world-quest-library.test.ts
Coupled: apps/agent-world/themes/fantasy/theme.json, apps/agent-world/themes/anime-school/theme.json, apps/agent-world/themes/fantasy/overlays/notice-open.png

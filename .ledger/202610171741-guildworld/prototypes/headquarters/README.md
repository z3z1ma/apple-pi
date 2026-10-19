# PROTOTYPE: the Agent World headquarters

Throwaway prototype for [How places are built](../../decisions/15-how-places-are-built.md) (round 1), then [Characters and portraits](../../decisions/22-characters-and-portraits.md) and [Movement and pathing](../../decisions/23-movement-and-pathing.md) (round 2), built after [Purpose and form of the world](../../decisions/19-purpose-and-form-of-the-world.md) and [What a wing is](../../decisions/21-what-a-wing-is.md). Fantasy theme only. It shares nothing with the notch or the rejected Guild Hall room; from the town it borrows only exterior props and code-drawn ground tiles.

## Question

Do painted interiors, sized to what they hold and bigger than one screen, feel polished? Does a gallery of wing doors hold a growing number of remembered wings? Do painted interiors and a tiled exterior sit together? Does RuneScape-style movement and interaction feel right? What does a painted scene cost?

## Run

```sh
./serve.sh            # http://127.0.0.1:8766/
python3 snapshot.py   # optional: writes live.json from ~/.pi/agent/state/apple-pi.db (git-ignored)
```

You start in the guild hall. **Left click** walks to a tile, or does the default action of what is under the pointer (shown top left, RuneScape-style: yellow names are characters, cyan ones are objects). **Right click** opens the menu of every action. The avatar walks up to a character or door before acting. **Wheel** zooms. The bottom-left panel is a prototype control, not part of the design.

## Round 2: characters and movement

- **Characters:** seven characters (the avatar, the coordinator, five agent looks), each one Codex sheet of 16 frames on magenta: walking down, up, and left (right is the left walk mirrored), sitting from behind at work (two frames), standing, and asking with a raised hand. `clean_characters.py` cuts frames on their magenta gaps, scales every character to the same standing height (120 px), and sets feet on one baseline so frames do not jitter. Agents at a wing desk sit and write while busy, sit still while idle, and stand with a raised hand while asking you. Every character has a soft shadow.
- **Portraits:** each character also has four painted JRPG-style busts (neutral, happy, thinking, worried) shown large to the left of the dialogue box; the expression follows the session (asking you: worried, finished: happy, busy: thinking). The line types out while the portrait bobs as if talking; a click finishes the line.
- **Movement:** two modes, switched in the prototype controls. **Smooth** (default): an A* path on a grid twice as fine as the tiles, string-pulled into straight runs that keep clear of furniture, walked continuously at 175 px/s, ending exactly where you clicked. **Tiles:** RuneScape's tile-by-tile steps on the place's tile grid at 120 px/s. In both, a click on furniture walks to the nearest open floor, and a new click retargets at once.
- **Cost:** 14 Codex images in parallel, about two and a half minutes; about 1.4 MB of cut sprites and portraits.

## What to try

1. **The hall:** talk to Orla, the coordinator, at the head desk (portrait and typed line); examine the agent in the common room (an agent outside any repository). Walk around the furniture and click on it; switch **Movement** between smooth and tiles and compare.
2. **The gallery:** walk through the east archway. Each remembered wing is a door with its repository's banner; `legacy-auth` is closed up (boarded) because nobody works there now.
3. **A wing:** enter `apple-pi` (three agents, the small room) or `billing-service`; add agents with **+ agent** until a wing holds more than three, and it opens in the large room with eight desks. Status shows over heads: dots (working), `!` (asking you), a tick (finished, unseen).
4. **Growth:** **+ remembered wing** a few times, then revisit the gallery: it lengthens by repeating one niche section of the painting.
5. **Outside:** open the hall doors to the lane, a tiled exterior at dusk where an independent agent stands; enter the hall again.
6. **Live:** run `python3 snapshot.py`, then **Load live.json** to place your real sessions (a coordinator needs `pi --coordinator` or a session reporting to it).

## How it is built

- **Engine:** Phaser 4.2.1 (`vendor/`, MIT), plain ES modules, no build.
- **Painted interiors:** four scenes from Codex's image tool (`generate_art.sh`, all in parallel, about two minutes): the hall (30 × 20 tiles), the gallery (one corridor with five empty niches), and a wing room in two sizes (16 × 16 with three desks, 30 × 20 with eight). Each prompt describes the room on a tile grid with a person 1.5 tiles tall, so the scale comes out usable. Scenes are quantized to 256 colours (no visible loss at this scale), about 1 MB each.
- **Hand-authored over the paintings (`src/places.js`):** blocked tiles, character spots (desks), door hotspots, entry tiles, banner positions, all in tiles of 48 px. Authoring one scene took a few minutes of reading the painting.
- **Placed pieces:** doors (closed, open, boarded) and banners are separate sprites cut from one magenta sheet (`clean.py`), placed into the painted niches, so the gallery shows any set of wings. Repository names are drawn as text.
- **Growth:** the gallery repeats its fourth niche section once per wing beyond five; a wing chooses the small or large painting by headcount.
- **Exterior:** the lane is a tile map (code-drawn grass and cobbles from the town prototype) with the town's hall sprite and props, under a dusk wash with lamp glows to match the interiors.
- **Movement (round 1):** an 8-direction A* path over each scene's tile grid, one tile per 0.3 s; replaced in round 2 (above). Click crosses (yellow walk, red action); scenes change with a short fade.
- **World:** `src/world.js` derives the places from sessions: the coordinator in the hall, its awake agents in the wings of their repositories (wings remembered in `localStorage`), agents without a repository in the common room, dormant agents absent (their place, the inn, is not built), independent agents outside.

## Findings so far

- Painted interiors at room size look far richer than anything earlier, and sizing a room to its headcount (two paintings per room type) works without layout code.
- Placing door and banner sprites into empty painted niches works well; the repeated niche section is seamless.
- The tiled exterior looks plainer than the painted interiors even at dusk; exteriors will need richer tiles and hand-placed set pieces to match.
- Round 1's borrowed town characters were lower resolution than the paintings and read as pasted on; round 2 replaces them.

## Known gaps

- The sitting frames draw their own stool over the painted one; no occlusion of the avatar by furniture.
- Walk cycles are four frames from one image, so steps are approximate; there is no diagonal facing.
- Banner text can overflow a cream banner in the large wing.
- No inn, no other function places, no dialogue beyond a status line, no second theme.
- Wing memory is the browser's `localStorage`, not Agent World's store.

## Verdict

Operator, 2026-10-18: "you are 100% moving in the right direction" for interiors.

- **Painted interiors: confirmed.** The hand-painted scenes are the direction ("amazing").
- **Characters: rejected.** The borrowed sprites kill the experience. Use somewhat higher-definition sprites that look good, walking that looks better, and a talking portrait beside the dialogue box: a RuneScape-style talking head, or a larger JRPG-style portrait with expressions on the left. Either is fine.
- **Pathing: subpar,** and bad pathing alone can kill the experience.
- **Exterior: rejected.** The tiled lane is far from the vision; interiors are on track.
- **Crowding:** larger rooms can seat several agents at one painted table, so rooms have headroom before a bigger painting is needed.
- **Polish later:** many more things to interact with and fidget with ("ADHD paradise"); many nits.
- Fixed after the verdict: right click no longer opens the browser's menu over the HTML chrome.

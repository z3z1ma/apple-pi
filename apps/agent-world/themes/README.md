# Theme packs

A theme pack is one directory here, named by the theme's id. The world draws the same places, characters, states, and actions in every pack; a pack changes only how they look and what they are called. A pack is a set of files, not code: its manifest, a stylesheet for the world's HTML, paintings with their place data, character sheets and portraits, and overlays. The contract and the pack check live in `../src/theme-pack.ts`; this page is the summary for theme authors.

Check a pack before you open it in the world, from the repository's root:

```sh
node --import ./components/session-state/src/register.mjs apps/agent-world/src/check-theme.ts apps/agent-world/themes/<id>
```

It prints each problem as `<pack>/<file>: <fault>` and exits 1 when there is any. Without a directory it checks every pack here. The world checks a pack again before it wears it; a broken pack never half-loads: the world stays in (or opens in) the last good theme and says on screen which file is wrong and why.

## Layout

| Path | What |
| --- | --- |
| `theme.json` | The manifest (below). |
| `interface/skin.css` | How the world's HTML looks (the manifest's `skin`), with any textures it uses beside it. |
| `places/<place>.json` | Each place's data over its painting `places/<painting>.png`. |
| `characters/looks.json` | Every look: its role, frame size, and baseline. |
| `characters/<look>.png` | Its 16-frame sheet. |
| `characters/<look>-portrait-0..3.png` | Its four expressions: neutral, happy, thinking, worried. |
| `overlays/<name>.png` | Doors, banners, the bed, letters, birds, fire, water, and fidget objects. |

## The manifest

- `id` (the directory's name) and `name` (shown in Settings); `description`, one line for Settings.
- `labels`: what the theme calls every place (`headquarters`, `common-room`, `gallery`, `wing`, `square`, `forge`, `quest-office`, `library`, `inn`, `rookery`) and every role (`coordinator`, `worker`, `independent`, `innkeeper`, `rookery-keeper`, `smith`, `clerk`, `librarian`, `crier`, `townsfolk`): Guild hall, Office floor, Classroom; Guildmaster, Lead, Class rep. `wing` follows a repository's name ("apple-pi wing").
- `text`: the theme's own lines, by key (`TEXT_KEYS`): what the inn's host says, how mail is named, what the conversation panel says while it opens. `{name}`, `{count}`, and the like are filled in.
- `style`: CSS custom properties put on the page's root (`STYLE_TOKENS`): the fonts, the inks, the accent, the danger colour, the backdrop, and the main surfaces of the interface frame and the conversation panel (`--aw-frame-background`, `--aw-surface-background`, `--aw-panel-cover`, `--aw-panel-page`, `--aw-veil`). A value may name a file in the pack with `url(...)`, relative to the pack (frame textures). Optional `--aw-icon-<tab>` tokens (`TAB_ICONS`: `agents`, `needs-you`, `work`, `mail`, `slack`, `places`, `settings`) give a side-panel tab the pack's own icon, `url(...)` of an SVG in the pack drawn in the tab's ink through a mask (only its shape counts, so draw it in any one colour on transparency): fantasy's scroll and signpost, the tech office's board and pin, the anime school's notebook and school. A tab without one wears the world's own.
- `skin`: the stylesheet, relative to the pack.
- `world`: what the world draws on its canvas, where CSS does not reach: the backdrop, the font, speech bubbles, the small sign, sleepers' "z", state badges, the colour of lamp glow, where a banner's name goes (`banner.text` and `banner.hover`, fractions of `banner-cream.png`), and, when a place has a `bed` slot, where a sleeper's head and the covers are in `bed.png` (px); and, when the notice sprites paint board around the paper, which part of them is the notice (`notice.paper`, fractions) and whether to cut the board left around it away (`notice.cutOut`).

## The skin

The world UI's own CSS only lays things out. The skin gives them their look: every colour, face, border, background, and shadow, for the classes the world's HTML uses. It loads after the world's CSS, so at equal specificity its rules win, and it may change layout too where a theme needs it (a document window's title bar, a notebook's binding). The check makes sure it styles at least the classes in `SKIN_CLASSES` (the interface's frames, surfaces, tabs, and buttons; the conversation panel and its panes; the places' panels; the pointer's menu). `fantasy/interface/skin.css` is the full reference: an open book; `tech-office` draws a document window, `anime-school` a notebook.

## Shared conventions

Shared by every pack, so the world works the same in each:

- **The places** above, each with its painting and data file (`PlaceData`): a grid of 48 px tiles traced on a half-tile grid, blocked rects, spots, entries, doors (rect, stand point, destination), overlay slots, and the place's host. The square's host is its crier (a `crier` look), whom the operator asks for any Slack channel; its spots hold independent agents first and, on those left free, one townsperson per Slack channel with unread messages, so the spots are also how many townsfolk the square holds. The forge's host is its smith (a `smith` look), and its `work` slots, on the workbenches, are where the open pull requests lie (the rest wait "on the rack", in the smith's list): the check requires both. The quest office's host is its clerk (a `clerk` look), and its `notice` slots, on its board, are where the operator's Jira issues are pinned, the most pressing first (the rest wait "at the counter", in the clerk's list); the library's host is its librarian (a `librarian` look). A `furniture` piece whose `use` is `clerk` or `librarian` opens that host's list (the piece holding the notices reads as the board). Geometry is not shared: each theme lays out its own rooms. The painting must fit the grid (the same px per tile across and down); every spot, entry, and door's stand point must be on open floor.
- **Character sheets**: 16 frames in one row (walking down, up, and left, four phases each; seated twice; standing; asking), every frame standing on the look's baseline, 120 px from head to feet standing (frame 14). Four portraits each, 360 px tall.
- **Overlays**: the slot kinds (`fire`, `water`, `glow`, `banner`, `fidget`, `bed`, `window`, `letters`, `work`, `notice`) and the overlay names. A `notice` slot is a notice's centre on the board (`at`) and its width (`w`); its notices are `notice-open`, `notice-urgent` (a high priority), `notice-progress` (work started), and `notice-done`. A `work` slot gives the bottom centre of what a piece covers (`at`), its width (`w`), and for a diagonal piece such as a blade a clockwise `turn` in degrees that lays it flatter along its bench; its pieces are `blade-passing`, `blade-failing`, and `blade-running` (whatever the theme draws: blades, devices, robots).

## Required and optional

Required, or the check fails: the manifest with every label, line, and token; the skin; every place's data and painting (both wing sizes); at least three agent looks, a coordinator, an avatar, a townsperson, and each host's look, each with its sheet and four portraits; doors open, closed, and boarded; `banner-cream`; four `bird` frames; and wherever a place has such a slot, four frames of fire or water, `bed` (with `world.bed`), `letters`, the three `blade-*` pieces for `work`, or the four `notice-*` notices. Places with their own needs (`PLACE_NEEDS`: the forge's smith and `work` slots, the quest office's clerk and `notice` slots, the library's librarian; each host wearing a look of its role) fail the check without them. Everything else is optional and simply absent when missing: extra room sizes, ambient animation, fidget objects, other banners.

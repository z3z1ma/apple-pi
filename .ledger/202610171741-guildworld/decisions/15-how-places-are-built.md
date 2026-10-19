Type: prototype
Status: claimed
Blocked by: 05, 18, 19

# How places are built

## Question

How are headquarters, wings, buildings, and hubs drawn, and how do they grow with the number of sessions?

Compare one-shot painted interiors, a tile-based approach, and a combination (for example a painted shell with tiled or modular wings), at the decided 3/4 top-down view and 32 px tiles. Test with real counts: a headquarters with zero to several wings, buildings holding one to many sessions, and a town of several buildings and the four hubs (Jira, GitHub, Confluence, Slack). Decide the production art pipeline: which assets are generated, how they are cleaned, and what a theme must supply. The operator judges the feel.

Design this prototype from Agent World's own goals (a full-screen town of headquarters, wings, buildings, and hubs; characters you walk to and talk with) with zero carry-over from the notch: no single painted room, no 2x2 pose sheets, no glyphs baked into sprites. The operator expects a drastically different, net-new experience from the Guild Hall art and scale prototype.

## Settled before the build

Operator, 2026-10-18:

- **Engine:** Phaser 4, per [Shell and service runtime](08-shell-and-service-runtime.md).
- **Growth by districts:** each coordinator's headquarters anchors its own district, with its wings attached; independent buildings fill a shared commons district; the hubs sit around a central plaza.
- **Stable places:** a building keeps its lot across restarts and as other places come and go (seeded from the tmux session name and remembered).
- **Empty buildings:** while a tmux session exists but holds no Pi sessions, its building stays, dark and empty; it goes when the tmux session ends.
- **Art:** a newly generated modular tile kit, so look and growth are judged together.

## Interim verdict (operator, 2026-10-18)

Prototype: [prototypes/town/](../prototypes/town/README.md). The asset pipeline is strong, but the town was "not even a fraction" of the vision: an isometric-looking layout with no personality. Before any further world prototype, the shared state model comes first, then the purpose and form of the world are revisited (separate areas? is the guild indoors? how do indoor and outdoor areas differ?). The ticket stays open behind [Shared state model spec lands](18-shared-state-model-spec-lands.md).

Update 2026-10-18: [Purpose and form of the world](19-purpose-and-form-of-the-world.md) made every place hand-designed and tied places to functions and reporting, not tmux sessions. The "settled before the build" points about districts per coordinator, lots seeded from tmux session names, and empty buildings per tmux session no longer hold. The question becomes how a hand-designed place is authored and drawn per theme (tile kit, painted, or both), how the headquarters makes room as its agents and wings grow, and the production art pipeline.

## Working notes

Operator, 2026-10-18:

- Interiors look best as painted scenes; exteriors are better built from tiles. So places are a mixture: painted interiors, tiled exteriors.
- A scene need not fit one screen: interiors are produced at different sizes for the number of things and characters they are expected to hold, and the view moves around them.
- The aesthetic must be very, very polished.
- The headquarters holds its remembered wings as a gallery of doors, one per wing with its repository's banner; each door opens that wing's own room. The gallery extends as wings are added.
- Movement and interaction should feel like RuneScape: click a tile to walk there along a path, hover shows the default action, left click does it, right click opens a menu of actions, and the avatar walks up to a character or door before acting.

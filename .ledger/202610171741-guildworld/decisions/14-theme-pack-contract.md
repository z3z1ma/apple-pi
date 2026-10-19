Type: interrogation
Status: resolved
Blocked by: 04, 05, 15, 19, 22, 24, 26

# Theme pack contract

## Question

What is a theme pack, and what must every pack supply?

Decide the manifest fields, what geometry and anchors are shared across packs, required versus optional assets and fallbacks, how place and role labels are translated, and how packs are validated. Every pack names and draws the same places: headquarters, wings, buildings, and the four hubs. The first test is the flagship fantasy pack plus two thin packs (academy, SF office).

Update 2026-10-18: the places every pack draws are now the function places of [Purpose and form of the world](19-purpose-and-form-of-the-world.md) (headquarters with wings, incoming work, code, knowledge, Slack, mail, dormant agents, independent agents, and the connective tissue), each hand-designed per theme; the first packs are fantasy, tech office, and anime school.

## Answer

Decided with the operator, 2026-10-18.

- **A pack** is a directory with a manifest and one folder per kind of asset. The manifest holds the theme's id and name, labels for every place and role (Guild hall, Office floor, Classroom; Guildmaster, Lead, Class rep), and style tokens for the interface frame and the conversation panel (book, document window, notebook).
- **Places:** every function place hand-designed for the theme: the headquarters and wing rooms in at least two sizes, the forge, quest office, library, inn, and rookery, and at least one exterior with a door per place. Each place has its painting(s) plus a data file with its walk grid, character spots, doors (hotspot, stand point, destination), entries, and named overlay slots (fire, water, glow, banner, things to fidget with).
- **Characters:** a set of looks, each a 16-frame sheet in the shared layout and standing height with four portrait expressions; extra looks for Slack townsfolk; one look for the operator's avatar.
- **Overlays:** doors (open, closed, boarded), banners, animated fire and water, glows, and fidget objects in the theme's style.
- **Shared by every pack:** the list of places, the place data format, the sprite frame layout, standing height, and tile size, the four portrait expressions, and the overlay slot types. Geometry is not shared: each theme lays out its own rooms.
- **Required versus optional:** every place, both headquarters sizes, the character and portrait set, doors and banners, and the interface skin are required, and a pack without them fails validation; extra room sizes, ambient animation, and fidget objects are optional and simply absent when missing.
- **Validation:** a pack check confirms the required files, the sprite sheets' frame layout, grids inside their paintings, and entries, stand points, and spots on open floor.
- **Production:** the same Codex prompts with the theme's style, authored by an agent and reviewed by the operator.
- **First packs:** fantasy as the flagship; tech office and anime school as thin packs that supply the required minimum, to prove nothing in the world is fantasy-specific.

#!/usr/bin/env bash
# PROTOTYPE (throwaway): generate the painted headquarters art with Codex's image tool, all sheets in parallel.
# Writes raw-art/*.png; existing files are kept, so delete one to regenerate it.
set -uo pipefail
cd "$(dirname "$0")/raw-art"

STYLE="Polished hand-crafted pixel art of top-tier indie RPG quality (Eastward, Sea of Stars, Octopath interiors), 3/4 top-down view looking down from the south so the floor is fully visible and the south wall is cut away, warm evening lighting from lanterns, candles and fireplaces, rich but cohesive palette, crisp pixels, consistent perspective, no people, no text, no letters, no UI, full bleed with no border."

gen() {
	local file="$1" prompt="$2"
	[ -f "$file" ] && return 0
	codex exec -s workspace-write --skip-git-repo-check \
		"Use your image generation tool to create this image, then save the PNG as ./$file. Do not create or edit any other file. Image: $prompt" \
		> "${file%.png}.log" 2>&1
	[ -f "$file" ] && echo "made $file" || echo "FAILED $file (see ${file%.png}.log)"
}

gen hall.png "A wide landscape image (3:2) of the interior of a grand fantasy adventurers' guild hall. Think of the floor as a grid 30 squares wide and 20 deep, where a standing person is about 1.5 squares tall. North wall across the top: warm timber and stone with tall arched windows, hanging guild banners and lanterns. Centre-north: a raised two-step wooden dais holding a large carved guildmaster's desk with a high-backed chair, a world map, candles and a quill, open floor in front of the desk. West third: a cozy common room with a big stone fireplace with a lit fire, two armchairs, a sofa, a round rug, bookshelves and a round table with chairs. East wall: one wide open stone archway near the middle of the east wall leading into a dim corridor beyond. Centre floor: polished wooden planks with a long woven runner rug from the south door to the dais, benches along the walls, potted plants. South edge centre: a wide wooden double door to the outside. Keep plenty of open walkable floor between furniture. $STYLE" &

gen gallery.png "A very wide landscape image (2:1) of a long horizontal guild hall corridor seen in 3/4 top-down view. The north wall runs across the top with five identical, evenly spaced, empty arched stone niches, each niche exactly the same and framed by timber pillars, each niche empty (plain recessed stone, no door, no decoration inside) because doors are placed in them later; small lanterns on the pillars between niches. The west end (left edge) is an open stone archway back into a bright hall; the east end (right edge) is a closed timber wall with a small window. Floor: polished wooden planks with a long red runner carpet along the corridor. The middle three niche sections must look identical so they can be repeated. $STYLE" &

gen doors.png "A pixel art sprite sheet on a solid flat pure magenta #FF00FF background, items in one row with wide magenta gaps between them, all drawn front-facing in the same 3/4 top-down RPG style and the same size, each sized to fill an arched stone niche about 2 squares wide and 3 tall where a person is 1.5 squares tall: 1. a closed arched oak door with iron bands and warm light glowing under it; 2. the same door standing open, revealing a warm glowing workshop interior; 3. the same door closed up: boarded with crossed planks, a little dust and cobweb, unlit; 4. a hanging cloth banner on a short iron rod, plain cream cloth with a simple embroidered border and an empty middle (no emblem, no text); 5. the same banner in deep red cloth. Polished hand-crafted pixel art, crisp edges, no anti-aliasing against the magenta, no text." &

gen wing-small.png "A square image of a cozy fantasy guild workshop room: the wing of a guild hall where adventurers work on one project. Think of the floor as a grid 16 squares wide and 16 deep, where a standing person is about 1.5 squares tall. North wall: timber and stone with a window and an empty iron rod centred high on the wall where a banner will hang (leave the rod empty). Three sturdy wooden workbench desks with stools, each desk with scrolls, tools, a candle and a small crystal, spaced apart with open floor around them; shelves of supplies and a chalkboard on the walls; a door at the south edge centre. Keep open walkable floor between desks. $STYLE" &

gen wing-large.png "A wide landscape image (3:2) of a large cozy fantasy guild workshop hall: the wing of a guild hall where a team of adventurers works on one project. Think of the floor as a grid 30 squares wide and 20 deep, where a standing person is about 1.5 squares tall. North wall: timber and stone with tall windows and an empty iron rod centred high on the wall where a banner will hang (leave the rod empty). Eight sturdy wooden workbench desks with stools in two rows of four, each desk with scrolls, tools, a candle and a small crystal; a central work table with a large map; shelves, a supply rack, a chalkboard and a small hearth on the walls; a door at the south edge centre. Keep open walkable aisles between desks. $STYLE" &

wait
ls -la

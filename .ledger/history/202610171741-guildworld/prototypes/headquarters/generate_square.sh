#!/usr/bin/env bash
# PROTOTYPE (throwaway): generate the painted village square and its overlay sprites with Codex's image tool.
set -uo pipefail
cd "$(dirname "$0")/raw-art"
gen() {
	local file="$1" prompt="$2"
	[ -f "$file" ] && return 0
	codex exec -s workspace-write --skip-git-repo-check \
		"Use your image generation tool to create this image, then save the PNG as ./$file. Do not create or edit any other file. Image: $prompt" \
		> "${file%.png}.log" 2>&1
	[ -f "$file" ] && echo "made $file" || echo "FAILED $file"
}
gen square.png "A wide landscape image (3:2) of a cozy fantasy village square at dusk, seen in a 3/4 top-down view from the south, polished hand-crafted pixel art of top-tier indie RPG quality (Eastward, Sea of Stars), warm lantern-lit windows against a violet evening sky, rich but cohesive palette. Think of the ground as a grid 32 squares wide and 21 deep, where a standing person is about 1.5 squares tall. Along the north edge, building fronts facing the square, each with a clear front door at ground level: in the centre a grand stone guild hall with wide wooden double doors and banners; to its left a blacksmith forge with a glowing open workshop doorway and an anvil sign; to its right a library with an arched door and a book sign. On the west side a timber quest office with a notice-board sign above its door; on the east side a cosy inn with a hanging tankard sign and a door; in the north-east corner a small round stone rookery tower with a little door and perches. Centre: a large round stone fountain whose basin is EMPTY and dry, with no water drawn at all (water is added later as an animation). Around it an open cobblestone plaza with plenty of empty walkable space, a few benches and flower planters at the edges, four iron lampposts whose lanterns are unlit glass (light is added later), one small market stall at the south-west edge, and cobbled lanes leaving the square to the south and east. No people, no animals, no text, full bleed with no border." &
gen cat.png "A pixel art sprite sheet on a solid flat pure magenta #FF00FF background, one row of four equal cells with wide magenta gaps: the same small grey tabby cat in polished hand-crafted pixel art of top-tier indie RPG quality, 3/4 top-down view, about 40 pixels tall: (1) sitting, tail curled; (2) sitting, tail raised; (3) loaf pose with eyes closed; (4) stretching. Clean dark outline, no shadow, no text." &
wait

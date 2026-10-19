#!/usr/bin/env bash
# PROTOTYPE (throwaway): generate character sprite sheets and dialogue portraits with Codex's image tool.
# Writes raw-art/chars/<name>-sheet.png and <name>-portrait.png; existing files are kept, so delete one to redo it.
set -uo pipefail
mkdir -p "$(dirname "$0")/raw-art/chars"
cd "$(dirname "$0")/raw-art/chars"

declare -A LOOK=(
	[avatar]="a young adventurer: auburn hair in a short ponytail, teal travelling cloak over a cream tunic, brown belt and boots, small leather satchel"
	[coordinator]="an elderly guildmaster: long silver beard, deep blue robe with gold trim, round spectacles, wooden staff with a small brass lantern"
	[artificer]="a dwarf artificer: ginger braided beard, rolled sleeves, brown leather apron with tools, brass goggles pushed up on the forehead"
	[scholar]="an elven scholar: long dark hair, forest green robe with a gold sash, a quill behind one ear, pointed ears"
	[scout]="a halfling scout: curly brown hair, mustard yellow vest over a white shirt, red scarf, bare feet"
	[engineer]="a human engineer woman: short black hair, burgundy coat, a single steel shoulder plate, wrench at her belt"
	[mage]="a young mage: purple hood down over pale blond hair, lavender robe with silver stars, freckles, a small glowing orb at the belt"
)

gen() {
	local file="$1" prompt="$2"
	[ -f "$file" ] && return 0
	codex exec -s workspace-write --skip-git-repo-check \
		"Use your image generation tool to create this image, then save the PNG as ./$file. Do not create or edit any other file. Image: $prompt" \
		> "${file%.png}.log" 2>&1
	[ -f "$file" ] && echo "made $file" || echo "FAILED $file"
}

sheet() {
	gen "$1-sheet.png" "A pixel art character sprite sheet on a solid flat pure magenta #FF00FF background: a grid of 4 columns and 4 rows of equal cells with wide magenta gaps, every cell showing the same single character at exactly the same size and scale, full body, feet at the same height in every cell. Polished hand-crafted pixel art of top-tier indie RPG quality (Eastward, Sea of Stars, Octopath), drawn for a 3/4 top-down view, about 100 pixels tall, clean dark outline, soft warm shading, no ground shadow, no text. Row 1: walking toward the viewer (facing down), four walk-cycle frames with clearly alternating legs and swinging arms. Row 2: walking away from the viewer (facing up, back visible), four walk-cycle frames. Row 3: walking to the left in side profile, four walk-cycle frames. Row 4: (1) sitting on a low stool seen from behind, leaning forward writing at a desk that is not drawn; (2) the same pose with the writing arm moved; (3) standing relaxed facing the viewer; (4) standing facing the viewer with one hand raised high as if asking a question. Character: $2"
}

portrait() {
	gen "$1-portrait.png" "A 2 by 2 grid of four dialogue portraits on a solid flat pure magenta #FF00FF background with wide magenta gaps: the same character as a head-and-shoulders bust, the same size and framing in every cell, in four expressions: (1) neutral and attentive, (2) happy and smiling, (3) thinking with a hand at the chin, (4) worried, asking a question. Painted JRPG portrait style like Octopath Traveler or Sea of Stars dialogue portraits: expressive face, warm candlelit fantasy lighting, rich colour, clean edges against the magenta, no text, no frame. Character: $2"
}

for name in "${!LOOK[@]}"; do
	sheet "$name" "${LOOK[$name]}" &
	portrait "$name" "${LOOK[$name]}" &
done
wait
ls

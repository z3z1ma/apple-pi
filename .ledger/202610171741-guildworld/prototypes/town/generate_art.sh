#!/usr/bin/env bash
set -euo pipefail

# Art generation script for Agent World Town prototype
# Generates modular sheets using Codex image generation tool with pure magenta backgrounds

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAW_DIR="${DIR}/raw-art"
mkdir -p "${RAW_DIR}"
cd "${RAW_DIR}"

echo "Starting modular art kit generation via Codex..."

# 1. Four Hubs
if [ ! -f "hubs.png" ]; then
  echo "Generating hubs.png..."
  codex exec -s workspace-write --skip-git-repo-check "Use your image generation tool to create this image, then save the PNG as ./hubs.png. Do not edit any other file. Image: A 2D cozy pixel art sprite sheet of four distinct medieval storybook buildings for a town plaza, isolated on a solid flat pure magenta #FF00FF background. 3/4 top-down perspective, Stardew Valley and Witchbrook aesthetic, warm twilight palette with glowing amber lanterns: 1. The Forge: cozy stone blacksmith workshop with glowing fiery furnace arch, stone chimney with light smoke, anvil outside, dark timber beams. 2. The Great Library: scholarly stone pavilion building with stained glass arched windows, carved book carvings, celestial brass globe on top. 3. The Quest Board: large rustic wooden guild bulletin notice board with pinned paper quests, wooden roof awning, glowing lanterns hanging from posts. 4. Town Square Gazebo: communal open wooden pavilion gazebo with round roof, festive bunting, warm hanging lantern chandelier, flower planters. All elements cleanly separated with ample solid magenta #FF00FF between them. Sharp pixel art edges, no anti-aliasing against background."
fi

# 2. Headquarters and Wings
if [ ! -f "headquarters_wings.png" ]; then
  echo "Generating headquarters_wings.png..."
  codex exec -s workspace-write --skip-git-repo-check "Use your image generation tool to create this image, then save the PNG as ./headquarters_wings.png. Do not edit any other file. Image: A 2D cozy pixel art sprite sheet of modular guildhall architecture for a storybook town, isolated on a solid flat pure magenta #FF00FF background. 3/4 top-down perspective, Stardew Valley and Witchbrook style, warm twilight stone masonry, ivy on walls, slate crooked roof, warm glowing arched windows: 1. Main Guildhall Headquarters: grand central stone hall with arched wooden double doors, lantern sconces, steep crooked roof with gables, ivy creeping up stone. 2. Left Wing module: matching stone and timber wing section designed to seamlessly connect to the left side of the guildhall, with warm glowing window. 3. Right Wing module: matching stone and timber wing section designed to connect to the right side of the guildhall, with chimney and glowing window. 4. Tower Annex module: tall stone and timber tower wing that attaches to the hall. 5. Dark/empty variant of the wing module with dark unlit windows. Crisp pixel art, pure flat magenta #FF00FF background, separated parts with space between them."
fi

# 3. Independent Buildings (Lit and Dark variants)
if [ ! -f "buildings.png" ]; then
  echo "Generating buildings.png..."
  codex exec -s workspace-write --skip-git-repo-check "Use your image generation tool to create this image, then save the PNG as ./buildings.png. Do not edit any other file. Image: A 2D cozy pixel art sprite sheet of independent town houses and workshops, isolated on a solid flat pure magenta #FF00FF background. 3/4 top-down perspective, Stardew Valley / Witchbrook style, warm cozy twilight aesthetic: 1. Cozy two-story stone cottage with crooked terracotta tile roof, ivy, warm glowing windows and wooden door. 2. The same cottage in dark unlit version: windows are dark/unlit, chimney has no smoke, closed door. 3. Timber frame craftsman workshop with dormer window, warm glowing interior light, stone foundation. 4. The same craftsman workshop in dark unlit version with dark unlit windows. 5. Small cozy stone lodge with pitched slate roof, flower window boxes, warm glow. 6. The same stone lodge in dark unlit version with dark unlit windows. Flat pure magenta #FF00FF background, cleanly spaced sprites, sharp pixel boundaries."
fi

# 4. Props & Terrain
if [ ! -f "props_terrain.png" ]; then
  echo "Generating props_terrain.png..."
  codex exec -s workspace-write --skip-git-repo-check "Use your image generation tool to create this image, then save the PNG as ./props_terrain.png. Do not edit any other file. Image: A 2D cozy pixel art sprite sheet of town props and terrain tiles for a storybook RPG town, isolated on a solid flat pure magenta #FF00FF background. 3/4 top-down perspective, Stardew Valley / Witchbrook style: 1. Ornate iron and wood streetlamp post with glowing warm amber lantern at twilight. 2. Cozy pine tree and flowering deciduous tree with pink blossoms. 3. Stone retaining wall segment and stone steps. 4. Wooden park bench. 5. Cobblestone plaza paving tiles and stone path tiles. 6. Lush grass patches with tiny wildflowers. 7. Wooden direction signpost with wooden signboards. 8. Wooden barrels and crates with ivy. Flat solid magenta #FF00FF background, separate items with space between them."
fi

# 5. Characters
if [ ! -f "characters.png" ]; then
  echo "Generating characters.png..."
  codex exec -s workspace-write --skip-git-repo-check "Use your image generation tool to create this image, then save the PNG as ./characters.png. Do not edit any other file. Image: A 2D cozy pixel art character sprite sheet of 4 distinct town characters in 4-directional walk poses (down facing front, up facing back, left, right), isolated on a solid flat pure magenta #FF00FF background. 3/4 top-down perspective, Stardew Valley / RPG style, 32x48 pixel proportions: Row 1: Character 1 - Guildmaster wizard in blue hooded robe with gold trim and starry hat. Poses: walking down (front), walking up (back), walking side. Row 2: Character 2 - Artificer engineer in brown leather apron, goggles, boots and tool belt. Poses: walking down, up, side. Row 3: Character 3 - Adventurer scout in green tunic, cloak, and brown satchel. Poses: walking down, up, side. Row 4: Character 4 - Scribe scholar in burgundy coat with spectacles and carrying a leather book. Poses: walking down, up, side. Flat solid pure magenta #FF00FF background, neatly aligned, sharp pixel art."
fi

echo "Raw generation complete. Run clean.py next."

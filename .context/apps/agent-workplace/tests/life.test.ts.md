## file

Idle rhythm and wandering are plain logic over a real place. The built UI is in `world-life.test.ts`. Each idle plays about a second and a half, and no two characters start one at the same moment. Every wander step is on walkable floor. Back home, a wanderer stays a while before going out again. Called to work while out, it heads straight back and never stops in the avatar's way. Wanderers never block the avatar's grid.
Why: a shared idle start or a blocked avatar path would make the place feel stuck.

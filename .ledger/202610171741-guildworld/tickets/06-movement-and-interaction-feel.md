# 06: Movement and interaction feel

**What to build:** Moving and acting feel like RuneScape. Paths are found with A* on the half-tile grid and straightened into runs that keep a body's width from furniture. The avatar walks continuously, with the walk cycle matched to its speed, and ends where the operator clicked. A click on furniture walks to the nearest open floor, and a new click turns at once. The pointer shows the default action as hover text; left click does it, right click opens the menu of every action, and the browser's own menu never shows. The avatar walks up before it acts. Doors respond only over the door itself. The camera follows the avatar, the wheel zooms, and travel between places has a smooth transition.

**Blocked by:** 02 Places follow reporting and repositories

**Status:** ready-for-agent

- [ ] In headless Chrome on a fixture place, a click across a room produces a path that never enters a blocked cell and has no zig-zag between straight runs.
- [ ] Clicking on furniture ends the walk on the nearest open cell; a second click mid-walk changes course without stopping first.
- [ ] Right click lists every action on the target and the browser context menu never appears; hover text names the left-click action.
- [ ] Talking to a character or using a door walks the avatar to its stand point before acting; walking past a door does not travel.
- [ ] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.

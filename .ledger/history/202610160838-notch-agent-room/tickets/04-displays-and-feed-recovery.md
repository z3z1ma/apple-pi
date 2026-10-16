# 04: Panel follows display changes and recovers its feed

**What to build:** The notch panel stays at the notch when displays are connected or removed. Without a notched screen, it sits at the top centre of the main screen. If the agent feed process dies, the panel restarts it, and the live agents come back without a panel restart. See `plan.md`, Displays and Feed restarts.

**Blocked by:** 01 (Notch panel runs from the component, started by hand)

**Status:** done

- [x] With an external display connected or removed, the panel stays at the built-in display's notch, with the right width and height.
- [x] With no notched screen active (lid closed on an external display), the panel sits at the top centre of the main screen.
- [x] After a `kill` of the feed process, live agents reappear within a few seconds, and the panel's pid is unchanged.

# 03: `/btw` as a top drop-down

**What to build:** `/btw` opens anchored at the top center at half the terminal height instead of in the center. It still takes focus while the operator types, closes on `Esc`, and keeps its answer in the `/btw` session. Update `docs/btw.md`. See `../spec.md`.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] `/btw` opens with a top-center anchor instead of center, at most half the terminal height.

Regression guidance (not an acceptance criterion): existing `/btw` tests stay green.

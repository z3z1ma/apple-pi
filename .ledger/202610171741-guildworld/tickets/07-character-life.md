# 07: Character life

**What to build:** Characters show their state through how they live. Working agents sit at their tables; asking agents stand with a raised hand; idle agents stand. A badge over each head shows working, asking you, or finished and unseen. Characters that need the operator bark now and then, and portraits follow state. A character's animation may follow its last tool, purely for decoration. Waking agents walk in through their place's door, and stopping agents walk out instead of vanishing.

**Blocked by:** 02 Places follow reporting and repositories; 05 Characters and portraits

**Status:** done

- [x] In headless Chrome on a fixture backend, a session moving from idle to working to asking changes pose and badge each time, and the badge clears once seen.
- [x] A newly started session's character enters through the door and walks to its spot; a stopped one walks out.
- [x] Barks appear only for characters that need the operator.
- [x] Furniture in front of a character hides the part of it behind; asking characters stand on the floor, not floating above it.
- [x] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.

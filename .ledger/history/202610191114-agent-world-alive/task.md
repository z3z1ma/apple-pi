Status: done
Created: 2026-10-19
Updated: 2026-10-19

# Agent World: a more alive world

## Intent

Make Agent World feel alive after its first build (`.ledger/history/202610171741-guildworld/`), from the operator's walkthrough on 2026-10-19:
- **Feel:** a hand cursor with RuneScape click markers.
- **Correctness:** nothing floats or clips in any place; pets are varied and drawn to scale; notices are sized to their boards; the square's building signs carry names.
- **Life:** idle animations and wandering for every character, a cast of ambient NPCs who are there for fun, and one more exterior per theme.
- **Function:** recruiting agents in the theme's words, and fixes to Slack reading.

Decided with the operator (2026-10-19):
- Slack is marked read only by an explicit button.
- One more exterior per theme.
- Recruiting outdoors happens at a recruiter NPC in the square; in the headquarters it happens at the coordinator's desk.
- Ambient NPCs get lines and reactions, not running stories.

Added during the work at the operator's request: renaming agents from the world and fixing the recruit form (ticket 12), and human session names with a stated intent (ticket 13).

Done when every ticket in `tickets/` is done and the aliveness pass (ticket 11) is signed off.

## Current State

All thirteen tickets are done and committed (2026-10-19). The aliveness pass (ticket 11) was signed off by the agent on screenshots, not yet by the operator.

Open after closing:
- Slack, Jira, and Confluence were exercised only against fake servers; the Slack sign-in window has not run against a real workspace.
- The end-of-work suite had two unit failures outside this task: `components/session-state/tests/activity.test.ts` (it does not expect `list_peer_sessions`, made active by commit `812067f3`) and timeouts in `tests/pi-exec-work-panel.test.ts` under heavy load.

## Outcome

Agent World now feels lived in:
- **Feel:** a hand cursor with RuneScape-style click marks.
- **Correctness:**
  - no figure floats or clips in any of the 36 places;
  - five distinct, correctly scaled pets per theme;
  - notices sized to their boards, and named building signs.
- **Characters:** every character has idle animations and wanders a little, and a cast of four ambient NPCs per theme has its own lines and reactions.
- **Places:** a second exterior per theme (Harbour lane, Main street, Shopping street), with ambient motion in every place and outdoor light that follows the local time of day.
- **Agents:** recruit them in the theme's words, and rename them from the world.
- **Slack:** a channel opens at its first new message, and Mark read is an explicit button.
- **Sessions:** they carry human names, and say what they are doing as a stated intent when no ledger task covers it.

## Judgment calls

By ticket number; written for the operator's review.

- **02 depth:** fixed in place data only (about 40 foreground pieces re-cut, furniture footprints moved north, hosts moved onto floor, bells and other fidgets onto surfaces); tall objects (bookshelves, trees) still hide a figure standing right behind them, by design.
- **03 pets:** five distinct pets per pack, at most one per place, none in repeating rooms (headquarters, common room, wings), so a coordinator's copy never shows the same animal twice.
- **04 signs:** the fantasy square's painted boards are too small (or absent), so its six signs are drawn plates in colours sampled from the painting; tech and anime letter their painted boards.
- **05 Slack:** Mark read uses `conversations.mark` for channels and the web client's undocumented `subscriptions.thread.mark` for threads; it is logged but skips the confirmation dialog (the button is the explicit choice).
- **06 idle art:** the first idle sheets drew a different person for many looks; all idle sheets were regenerated with the look's own sheet attached as a reference image.
- **07 wandering:** life is off in headless tests unless a test asks for it; asking and finished-unseen agents stay at their spots so you can find them.
- **08 ambient NPCs:** four per pack, placed in the square, the inn, and the new exterior (never in repeating rooms); their lines show in the existing on-screen notice, which now stays up longer for longer lines.
- **09 second exterior:** the kind is `street` in every pack (Harbour lane, Main street, Shopping street), traced on the square's grid so people keep their size; the square has 14 townsfolk spots (was 10) and the street takes the overflow.
- **10 recruiting:** the anime courtyard has no painted booth, so its recruiter stands by the left bench.
- **12 rename:** renaming changes the Pi session's name, not the tmux window's.
- **13 names and intent:** names come from local lists (310 first, 299 family names), no model call; your sessions pick them up on their next start or `/reload`; I restarted your runtime (2026-10-19 15:15) so intents are stored. A forked session keeps its parent's name, so two live sessions can share one.

## file

Resolve people by the message's stable sender ID through awake and retained dormant snapshot entries. Display names are not addresses; duplicate names never justify guessing another session. The operator is a separate identity, not the operator's Pi session. Missing people have a read-only unavailable profile, without a fabricated DM target. Dormant and retained former members use the existing read-only conversation path.
Why: a familiar chat author must still point at the runtime's actual session, and a profile must not revive or impersonate one.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/overlay/conversation/conversation-panel.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts

Profiles consume snapshot observations and the World examine card's fact rows, with full Self fetched only on opening through the profile IPC. Opening one neither reads a transcript nor marks a result seen; Message opens the ordinary DM reader. Dormant adapters contain a placeholder cost, so the profile omits that value while retaining the observed role title. Current commands stay in the lower DM activity line, so profiles use compact status and omit the detailed Doing row. Profiles unmount while Chat is hidden. Chat owns the exact clicked avatar's focus target, including replacement of an already-open profile; component cleanup must not restore an older trigger during that replacement.
Why: viewing a person differs from entering their conversation, and World actions such as retirement do not belong in a chat profile.
Coupled: apps/agent-world/web/overlay/interface/character-card.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts

Recorded work appears after the Message control and before biographical facts. WorkHistory filters actual assignment participation by stable person ID and reads a task only on explicit opening; the older Record summary remains a separately expandable fallback only when no history entry contains that person. An absent history field or an empty/unrelated history therefore retains Record; matching history avoids a second inventory of the same completed work. The visible Close text retains the existing Close profile accessible name, focus target, and Escape/onClose behavior.
Why: the legacy Record is a title summary, not evidence of assignment participation. Replacing it only when this person has structured history avoids duplicate task inventories without hiding the only available record in older snapshots.
Coupled: apps/agent-world/web/workplace-work-history.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/world-org.test.ts

Record and each Self field independently preview the operator-chosen 200 characters, counting Unicode code points. Self arrives as rendered Markdown: only the four headings produced by `renderSelf` start fields; other headings stay in the current field, and legacy unkeyed prose stays under Notes. Plain text keeps its markup inert. Explicit `hiredAt` is labelled Hired; absent dates use the earliest observed incarnation labelled First seen, never an estimated hire date.
Coupled: components/organization/src/self.ts, apps/agent-world/src/backend/world-backend.ts, apps/agent-world/src/electron/main.ts, apps/agent-world/src/electron/preload.ts, apps/agent-world/src/world.ts
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/profile.test.ts

Avatar hues derive only from the stable ID, with separate light/dark lightness. Keep the same mapping in message, sidebar, header, and profile; list order, name edits, and appearance changes must not reassign someone's color. The small deterministic hash follows the existing character-life ID-seeding pattern without importing the Phaser lifecycle.
Verify: apps/agent-world/tests/world-conversation.test.ts

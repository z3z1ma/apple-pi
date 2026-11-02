## file

Resolve people by the message's stable sender ID through awake and retained dormant snapshot entries. Display names are not addresses; duplicate names never justify guessing another session. The operator is a separate identity, not the operator's Pi session. Missing people have a read-only unavailable profile, without a fabricated DM target. Dormant and retained former members use the existing read-only conversation path.
Why: a familiar chat author must still point at the runtime's actual session, and a profile must not revive or impersonate one.
Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/overlay/conversation/conversation-panel.tsx
Verify: apps/agent-workplace/tests/world-conversation.test.ts

Profiles consume snapshot observations and the World examine card's fact rows, with full Self fetched only on opening through the profile IPC. Opening one neither reads a transcript nor marks a result seen; Message opens the ordinary DM reader. Dormant adapters contain a placeholder cost, so the profile omits that value while retaining the observed role title. Current commands stay in the lower DM activity line, so profiles use compact status and omit the detailed Doing row. Chat profiles unmount while Chat is hidden. Chat passes its retained layout resize handle into this profile; Org sizes its outer details slot and passes no second separator. Keep layout lifetime separate from the observational reader's unmount/read lifetime. Chat owns the exact clicked avatar's focus target, including replacement of an already-open profile; component cleanup must not restore an older trigger during that replacement.
Why: viewing a person differs from entering their conversation. The named profile ellipsis delegates explicit lifecycle choices to WorkplacePersonActions; opening the observational profile remains separate from taking such an action. The existing Close control/focus target stays independent from that menu.
Coupled: apps/agent-workplace/web/overlay/interface/character-card.tsx, apps/agent-workplace/web/workplace-person-actions.tsx
Verify: apps/agent-workplace/tests/world-conversation.test.ts

Root/coordinator profiles offer the device-local OrgNameEditor between Message and work history. This is display metadata only, not a person rename or a capability grant; temporary/former people are excluded.
Coupled: apps/agent-workplace/web/workplace-org-name.tsx, apps/agent-workplace/web/workplace-names.ts

Recorded work appears after the Message control and before biographical facts. WorkHistory filters actual assignment participation by stable person ID and reads a task only on explicit opening; the older Record summary remains a separately expandable fallback only when no history entry contains that person. An absent history field or an empty/unrelated history therefore retains Record; matching history avoids a second inventory of the same completed work. The visible Close text retains the existing Close profile accessible name, focus target, and Escape/onClose behavior.
Why: the legacy Record is a title summary, not evidence of assignment participation. Replacing it only when this person has structured history avoids duplicate task inventories without hiding the only available record in older snapshots.
Coupled: apps/agent-workplace/web/workplace-work-history.tsx
Verify: apps/agent-workplace/tests/world-conversation.test.ts, apps/agent-workplace/tests/world-org.test.ts

Specialization is read-only `Character.specialization` metadata. `sleeperCharacter` must forward it from the dormant person so the same profile works while that person is at home. It uses the same plain-text 200-character expandable preview as Record, while role and Self remain separate. Empty specialization adds no profile field.
Why: the shared profile consumes adapted Characters, not dormant rows directly; omitting the field in that adapter would hide a recorded specialization merely because the person's process stopped.
Coupled: apps/agent-workplace/web/game/layout.ts, apps/agent-workplace/src/world.ts
Verify: apps/agent-workplace/tests/world-org.test.ts

Record and each Self field independently preview the operator-chosen 200 characters, counting Unicode code points. Self arrives as rendered Markdown: only the four headings produced by `renderSelf` start fields; other headings stay in the current field, and legacy unkeyed prose stays under Notes. Plain text keeps its markup inert. Explicit `hiredAt` is labelled Hired; absent dates use the earliest observed incarnation labelled First seen, never an estimated hire date.
Coupled: components/organization/src/self.ts, apps/agent-workplace/src/backend/world-backend.ts, apps/agent-workplace/src/electron/main.ts, apps/agent-workplace/src/electron/preload.ts, apps/agent-workplace/src/world.ts
Verify: apps/agent-workplace/tests/world-conversation.test.ts, apps/agent-workplace/tests/profile.test.ts

Presence follows Slack, at the operator's request: green for working, green with a z for idle (a live session that is not running), amber when asking, gray for away (no running process; formerly labelled asleep or at home). `presenceOf` is the one mapping; every avatar that shows a dot passes it, and labels say Away rather than Asleep. The dot's ring color is the surface behind the avatar (`--wp-presence-ring`).
Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/workplace-org-chart.tsx, apps/agent-workplace/web/workplace.css
Verify: apps/agent-workplace/tests/world-org.test.ts

Avatar hues derive only from the stable ID, with separate light/dark lightness. Keep the same mapping in message, sidebar, header, and profile; list order, name edits, and appearance changes must not reassign someone's color. The small deterministic hash follows the existing character-life ID-seeding pattern without importing the Phaser lifecycle.
Verify: apps/agent-workplace/tests/world-conversation.test.ts

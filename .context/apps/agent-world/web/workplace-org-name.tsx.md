## symbol:OrganizationNameForm

The shared form changes only a device-local display label: a stable head ID names that organization, while the reserved workspace key names the app independently of any person. Cancel preserves the saved preference; empty Save removes the override and restores the caller's default. Storage failure remains visible and keeps editing open, rather than implying the name persisted. Channel and title consumers use this same form without changing channel selection or reading history.
Why: the workspace heading has no corresponding session identity, and a failed persistence attempt must not appear as a saved rename in other mounted views. Escape cancels only this editor and stops propagation so a profile's window handler does not also dismiss the surrounding profile.
Coupled: apps/agent-world/web/workplace-names.ts, apps/agent-world/web/workplace.tsx

## symbol:OrgNameEditor

Normal headings carry no persistent Rename button. Only callers with an actual organization WorkHistory pass onOpenWork: they render a native name button within the requested heading, with Enter/Space opening work and context-menu keys still requesting Rename. Workspace aggregate/profile headings remain rename-only. The work button takes focus before opening so the existing dialog restores the exact name after Escape, including pointer activation on hosts that otherwise leave focus elsewhere. Right-click and Shift+F10/ContextMenu activation use the single Workplace menu provider; only choosing Rename mounts the inline form. After Save/Cancel, focus restoration waits until the normal title has mounted again. Channel forms supply their own close callback to restore their row or heading trigger.
Why: closing the inline form changes which DOM element exists; restoring focus before React replaces it would target an absent title. The menu's earlier focus restoration happens before the action mounts this form and is a separate ordering boundary. The work dialog captures document.activeElement when it mounts, so focus the actual name button before mounting it rather than assuming a pointer click focused it.
Coupled: apps/agent-world/web/workplace-context-menu.tsx, apps/agent-world/web/workplace-org-name.css, apps/agent-world/web/workplace-work-history.tsx, apps/agent-world/web/workplace.tsx
Verify: apps/agent-world/tests/world-org.test.ts

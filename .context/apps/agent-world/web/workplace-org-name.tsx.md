## symbol:OrgNameEditor

The editor changes only a device-local display label: a stable head ID names that organization, while the reserved workspace key names the app independently of any person. Cancel preserves the saved preference; empty Save removes the override and restores the caller's default. Storage failure remains visible and keeps editing open, rather than implying the name persisted.
Why: the workspace heading has no corresponding session identity, and a failed persistence attempt must not appear as a saved rename in other mounted views. Escape cancels only this editor and stops propagation so a profile's window handler does not also dismiss the surrounding profile.
Coupled: apps/agent-world/web/workplace-names.ts, apps/agent-world/web/workplace-org-name.css

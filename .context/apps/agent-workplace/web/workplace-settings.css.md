## file

Page layout belongs to .wp-settings-page; .wp-settings is the shell's active-application class.
Why: using the shell class for page layout would restyle the entire application while Settings is open.
Coupled: apps/agent-workplace/web/workplace-settings.tsx, apps/agent-workplace/web/workplace.tsx

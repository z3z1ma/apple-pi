## file

The menu is portalled into the trigger's enclosing wp-app, outside the individual sidebar/card/editor layout. Fixed positioning and viewport-bounded overflow keep long action lists out of those panels' clipping regions while retaining the app's light/dark palette variables.
Why: a menu rendered inside a scrolled card or editor panel can be clipped even when its coordinates are correct; a portal directly to body would instead lose the inherited Workplace theme.
Coupled: apps/agent-world/web/workplace-context-menu.tsx, apps/agent-world/web/workplace.css

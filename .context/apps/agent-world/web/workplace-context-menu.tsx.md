## file

One WorkplaceMenuProvider owns the active menu for the renderer. Consumer handlers only request items/coordinates; they do not mount separate menu stores. The portal targets the trigger's enclosing wp-app so light/dark palette variables survive portal placement. The World pointer menu remains separate because it owns game Actions, hover presentation and mouse-leave semantics.

Menu selection/Escape restores a still-connected trigger before the action opens its editor. Outside pointer dismissal preserves the clicked control's natural focus. Keyboard opening consumes only ContextMenu or Shift+F10, leaving ordinary input alone. A stable open/close callback keeps routine world snapshots from restarting the focus effect. Native buttons implement activation; arrow/Home/End navigation skips disabled items.
Why: names and editor tabs need one coherent keyboard/focus surface without importing game state or creating competing popups.
Coupled: apps/agent-world/web/workplace-context-menu.css, apps/agent-world/web/workplace-org-name.tsx, apps/agent-world/web/workplace.tsx

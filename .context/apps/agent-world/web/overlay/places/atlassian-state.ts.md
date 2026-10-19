## symbol:atlassian.askSignIn

Opens Settings through the `open-tab` intent and counts the request; `atlassian-settings.tsx` answers a count it has not seen, even when it mounts only after the request (Settings was not the open tab), and puts the cursor in the sign-in form.
Why: the side panel mounts Settings only when its tab opens, so a ref initialised on mount saw the request as already answered and never focused the form.
Coupled: apps/agent-world/web/overlay/places/atlassian-settings.tsx, apps/agent-world/web/view-state.ts, apps/agent-world/web/overlay/interface/interface.tsx

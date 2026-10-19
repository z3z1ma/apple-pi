## symbol:atlassian.dismiss

The quest office's and library's panels close through `dismiss`, not `close`: a confirmation over the panel (`gated-write.tsx`) registers a layer, and Escape, the close button, or a click on the world cancel it first, so Escape never drops an issue the operator was about to comment on.
Why: `PlaceDialog` handles Escape in a window capture listener before anything inside it, so the confirmation cannot catch Escape itself.
Verify: apps/agent-world/tests/world-quest-library.test.ts

## symbol:atlassian.askSignIn

Opens Settings through the `open-tab` intent and counts the request; `atlassian-settings.tsx` answers a count it has not seen, even when it mounts only after the request (Settings was not the open tab), and puts the cursor in the sign-in form.
Why: the side panel mounts Settings only when its tab opens, so a ref initialised on mount saw the request as already answered and never focused the form.
Coupled: apps/agent-world/web/overlay/places/atlassian-settings.tsx, apps/agent-world/web/view-state.ts, apps/agent-world/web/overlay/interface/interface.tsx

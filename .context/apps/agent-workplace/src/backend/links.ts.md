## file

Transcript links open through the main process. The window itself never navigates. Web links are http and https only. A file that macOS would run, install, or script, or any file with an execute bit, is shown in Finder instead of opened.
Why: a transcript is untrusted. A click must not run a program or send the window to an arbitrary URL.
Coupled: apps/agent-workplace/src/electron/main.ts, apps/agent-workplace/web/overlay/conversation/markdown.ts
Verify: apps/agent-workplace/tests/links.test.ts

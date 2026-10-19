# 30: First run and performance

**What to build:** The first launch is smooth: the Electron install shows its progress, a failed install says why and how to retry, and the app opens straight into the headquarters. Where the operator finds the world slow, it is profiled and the measured bottleneck is fixed. A start-up check covers Electron's window and packaging.

**Blocked by:** 11 Headquarters polish pass

**Status:** ready-for-agent

- [ ] On a machine without the Electron install, `/world` shows install progress and then opens the world; with the network off it fails with a retry message.
- [ ] The start-up check opens the packaged app and finds the world rendered.
- [ ] Each slowdown the operator reports is profiled, and the fix is shown by a before-and-after measurement.

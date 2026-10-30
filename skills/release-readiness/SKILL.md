---
name: release-readiness
description: "Make a go/no-go judgment for a real deployment or launch from release, rollback, operational and acceptance evidence. Use when shipping crosses owners; a clean code review alone does not establish readiness."
---

# Release readiness

Decide whether this particular artifact can safely reach its users. Read and follow the [shared process conventions](../handbook-writing/references/processes.md).

The authorized release owner chairs. Involve `release-engineering-lead`, the `service-owner`, verification and product acceptance owners, plus security, accessibility or first-use perspectives when relevant. The readiness decision does not itself grant deployment permission.

1. **Pin the release.** Identify the artifact/revision, intended environment and users, authorized rollout, stopping conditions and accountable operators. Evidence for an older build is not evidence for this one.
2. **Inspect the receiving path.** Check integrated behavior, required migrations and compatibility, access/setup, support ownership, observable health and a usable rollback or recovery path. Distinguish source checks, built artifacts, installed behavior and live activation.
3. **Confront gaps together.** Owners answer one another's risks in the release thread. The decision owner explicitly accepts within-scope residual risks or reports the missing evidence or authority. A green suite cannot erase an untested operational boundary.
4. **Record go, hold or no-go.** Name the exact release, decision, reasons, limits and next owner. If execution is authorized, record actual rollout observations separately from readiness; verify the user path and use [handoff](../handoff/SKILL.md) for ongoing responsibility.

Done is a release-specific decision and owned next action. A plan to deploy is not a completed deployment, and a successful rollout does not prove that every accepted risk disappeared.

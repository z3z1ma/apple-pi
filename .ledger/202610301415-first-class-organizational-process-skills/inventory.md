# Existing foundation for organizational process skills

Source inspection on 2026-10-30. This is planning evidence, not an executed process evaluation.

## The repository already has the packaging mechanism

- `package.json` publishes `skills/` and loads `./skills` as one package resource. New skills need ordinary `skills/<name>/SKILL.md` directories, not a new registry or extension.
- `tests/package-load.mjs:459-499` asserts the complete skill inventory, names, discovery diagnostics and invocation policies. Those assertions must change deliberately with an adopted catalog.
- Installed Pi `docs/skills.md` confirms that names/descriptions are advertised and bodies are read on demand. `disable-model-invocation: true` removes automatic model selection; explicit `/skill:<name>` remains available. Existing sessions need `/reload` after changes.
- Publication and model selection are separate. A packaged manual-only skill is not automatically visible as a choice to the agent.

## Nineteen skills cover engineering work well

| Existing area | Skills | Relevant reuse |
| --- | --- | --- |
| Shape work | `wayfinder`, `interrogate-to-design`, `to-spec`, `to-tickets` | Long-horizon decisions, design interviews, specifications, dependency-aware slices |
| Build and investigate | `implement`, `ralph`, `prototype`, `diagnosing-bugs`, `research`, `tdd`, `resolving-merge-conflicts` | Implementation ownership, bounded fresh-context execution, falsifying experiments, independent investigation |
| Judge architecture and changes | `improve-codebase-architecture`, `code-review`, `codebase-design`, `domain-modeling` | Evidence-based boards, independent first findings, challenge, explicit rulings and shared vocabulary |
| Explain and retain knowledge | `operator-sign-off`, `explain-change`, `llm-wiki`, `handbook-writing` | Human decisions, teaching checks, durable knowledge and process authoring |

Seven skills are explicit-entry workflows: `implement`, `improve-codebase-architecture`, `interrogate-to-design`, `to-spec`, `to-tickets`, `wayfinder`, `ralph`. The other twelve are model-discoverable. In particular, code review and the diagnostic hypothesis board already coordinate people from model-discoverable skills.

`handbook-writing` distinguishes user-invoked processes from model-invoked disciplines/vocabulary. New organizational processes need an explicit selection-policy decision rather than an accidental blanket extension of either group. Existing explicit-entry engineering workflows need not change with that decision.

## Several communication patterns already have real owners

- `code-review`: reviewers form first findings independently; a shared group-mail thread carries challenge and response; a chair other than the author rules on supported findings; incomplete coverage stays visible. Its two axes are standards and originating intent.
- `diagnosing-bugs`: when solo investigation stalls, independent investigators propose falsifiable hypotheses without the caller's current favorite; a skeptic checks the feedback loop and causal claims. This already owns the debugging variant of competing-hypothesis investigation.
- `implement`: builders own separate files, the lead owns integration, overlap is serialized, and review/sign-off follow the authorized scope. A new cross-team process should coordinate delivery rather than restate the implementation method.
- `research`: independent bounded source questions go to one-shot interns; the root verifies decisive evidence, with a standing skeptic when the decision warrants it. A second generic research skill would duplicate this owner.
- `operator-sign-off` and `explain-change`: existing owners for human approval and comprehension, including cold-reader checks. A handoff process may use these methods without replacing them.

## Skills own procedure; existing runtime capabilities own guarantees

`docs/organization.md#processes` and `skills/handbook-writing/SKILL.md` establish perspectives, chair, handoffs, operator sign-off, observable completion and team closeout. Standing people come first; staffing follows manager authority. Group membership is not an assignment, and chairing a process does not grant staffing or external-action authority.

`docs/boundaries.md` explicitly rejects native meeting/review/incident entities, a second workflow/task store, a handoff schema, calendars, fixed staffing thresholds and automatic restructuring. A process can use tasks, ordinary prose handoffs, task threads, addressed group mail, topic channels, pins, explicit attention, reminders and links without introducing any of those objects.

The six implemented inspection lenses are `progress`, `bottlenecks`, `coordination`, `experience`, `economics` and `predictions`. They support inquiry; they do not select interventions or certify productivity. Economics remains optional.

## Role coverage after the operator's review

The catalog has 32 roles, two with management capabilities (`coordinator`, `director-of-engineering`) and five with writing capabilities. Senior advisory titles do not establish authority to manage people. The [role-to-process audit](role-process-map.md) covers every role and the missing-accountability hypotheses that informed the revised plan. Its initial-draft count of 14 explicitly named roles measures the document, not actual organizational participation.

## Questions the proposal needed to resolve

1. Which new processes should agents select themselves within authorized work, and which should require explicit operator entry?
2. Which recurring outcomes merit their own skill, versus a communication technique or a variant within an existing skill?
3. Which first processes exercise materially different collaboration patterns, rather than many names for the same review board?
4. What concrete result and counterexample will establish that each skill is useful, beyond successfully loading Markdown?

## Boundaries of this inspection

No new skill, runtime feature, role or workflow state has been implemented. No process trial, loader test or package dry run was run for this planning inspection. Existing runtime behavior is supported by the preceding delivery evidence; this inventory adds source-grounded composition possibilities, not proof that a new process produces better decisions.

The older `.ledger/202610232305-handbook-org-runtime/task.md` remains a separate planning record. Its open coordinator-admission and program-peer working-directory questions are not prerequisites for same-organization collaboration with existing tools. A process plan must preserve any actual scope limitation rather than silently implement those policies.

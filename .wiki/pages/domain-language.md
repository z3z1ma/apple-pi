# Apple Pi harness

Apple Pi is an integrated environment for agent-assisted software engineering. This working glossary covers the active harness. Optional modules retained for others to reuse are outside its domain.

The groups are vocabulary areas, not established bounded contexts. Public subagents and Pi Exec model workers are distinct participant kinds. Task names an undertaking; job names runtime-managed work. Conventions for unqualified “agent” and “background” remain unsettled.

## Language

### Participants and collaboration

**Main agent**:
The agent responsible for the operator's active request, implementation decisions, and claims about the result.

**Pair programmer**:
The persistent advisory partner that follows the main agent's presented work and shares sourced learnings. Its findings are advice, not authorization to act.

**Consultant**:
An advisory specialist whose independent opinion helps resolve a consequential question. The main agent retains responsibility for the decision and its validation.

**Public subagent**:
A delegated teammate with its own resumable, steerable, and inspectable conversation. It is a distinct participant kind from a Pi Exec model worker, the pair programmer, and private side conversations.

**Agent type**:
A named teammate role with a defined purpose and default working guidance.

**Model profile**:
A named choice of model and thinking level for a workload. It conveys no permissions or capabilities.
_Avoid_: Permission profile

**Pair finding**:
An observation from the pair programmer about the main agent's work. A concern or blocker requires explicit consideration, but is not itself proof that the work is wrong.

**Child clarification**:
Advice to a public subagent drawn from an independent snapshot of its immediate parent's conversation. It is not new authorization from the operator.

**BTW conversation**:
The operator's private, read-only side conversation about the current work. Its answer joins the main conversation only by explicit operator choice.

### Execution and continuity

**Root session**:
The top-level Pi conversation that owns the operator's work and its delegated activities.

**Interactive child session**:
A Pi conversation owned by a parent session for delegated collaboration. It is distinct from a model worker inside a composed program.

**Pi Exec**:
The harness capability for bounded, type-checked programmatic composition of tools and model work.

**Pi Exec model worker**:
A model participant invoked within a composed program to return a result to that program. It is distinct from a public subagent and from the runtime that executes the program.

**Job**:
A session-owned command or deferred prompt with an inspectable lifecycle. A job finishing does not establish that the task it serves is complete.
_Avoid_: Managed task, background task

**Scheduled prompt**:
A self-authored prompt due after a relative delay in the current root session. It carries the original work's authority, not a fresh operator instruction.

**Scheduled command**:
A command due to start after a relative delay in the current root session. Its start does not require a new agent turn.

**Monitor**:
A command job whose complete output lines are events for the main agent while the command continues running.

**Forked continuation**:
A separate continuation of the main conversation for passive automatic work. Its result can join the parent conversation without starting or steering the main run, while its actions can still affect shared work.

### Learning and durable knowledge

**Notebook**:
The jointly curated collection of sourced learnings for the current session. It is distinct from a conversation summary and from durable project knowledge.

**Learning**:
Something discovered through a surprise, failure, workaround, or correction, together with what to do differently now.
_Avoid_: Task status, plan

**Learning reflection**:
A retrospective examination of recent session experience to capture missed learnings. It is distinct from placing those learnings in durable homes.

**Change reflection**:
A second look at the main agent's changes for simpler code and reader clarity. Keeping the changes as they are is a valid result.

**Distillation**:
The proposal-first placement of session learnings into their appropriate durable homes, subject to operator approval.

**Ledger**:
The project-local workbench for operational context about bounded undertakings. It is distinct from the notebook and the wiki.

**Task**:
An undertaking with its own intent, status, current state, and outcome. The ledger is its operational workbench; “ledger task” is a qualifier for explaining that relationship, not a separate kind of task.

**Retrospective**:
A task's concise account of what mattered and which lessons remain worth retrieving after the task ends.

**Project wiki**:
The project-local knowledge workbench for reusable context across undertakings. It supports, rather than replaces, authoritative project contracts.

**Session recall**:
Recovery of earlier conversation or file-operation evidence. It is distinct from retrieving the known sources of one notebook entry.

**Receipt**:
A scoped handle to historical content already presented to the pair programmer but folded from its view. It is not general access to the session or repository.

**Compaction**:
Reduction of the conversation's active context while retaining a usable account of prior work. It is distinct from curating learnings.

### Operator interaction

**Questionnaire**:
A structured set of related operator decisions with described choices and custom answers. It seeks a decision rather than supplying new authority on its own.

**Active work**:
The public subagents and jobs presented together for operator inspection. Their shared presentation does not make them one lifecycle or one kind of work.

**Prompt stash**:
The operator's temporary collection of unsubmitted prompts. It is distinct from conversation history and scheduled prompts.

**Input editor**:
The operator's prompt-composition surface with model identity and glanceable session status.

**Terse tool rendering**:
The compact presentation of tool activity with expandable detail. Presentation brevity is distinct from compression of the underlying command output.

**Completion notification**:
An operator-facing signal that a run has settled or attention is required. It is not proof that the requested work succeeded.

**Session status**:
The operator-facing indication that a root session is busy, idle, or waiting for input. An idle session can have unfinished delegated work.

### Integration and safety

**Search root guard**:
The boundary that requires agent searches to start in an appropriately scoped location. It is not a general filesystem sandbox.

**RTK integration**:
The harness's command-rewriting and output-compression capability for supported shell commands. It is distinct from terse tool rendering.

**Fast mode**:
The choice of priority service for supported model requests. It is distinct from model profile selection and thinking level.

**Hosted tool**:
A tool executed by the model provider rather than by the local harness.

**MCP integration**:
Pi's connection to external tool and resource services. It is distinct from provider-hosted tools and from the Pi Exec composition capability.

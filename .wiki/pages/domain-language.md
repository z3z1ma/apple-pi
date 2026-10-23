# Apple Pi harness

Apple Pi is an integrated environment for agent-assisted software engineering. This working glossary covers the active harness. Optional modules retained for others to reuse are outside its domain.

The groups are vocabulary areas, not established bounded contexts. Persons, interns, the pair programmer, and the BTW conversation are distinct participant kinds. Task names an undertaking; job names runtime-managed work. Conventions for unqualified “agent” and “background” remain unsettled.

## Language

### Participants and collaboration

**Main agent**:
The agent responsible for the operator's active request, implementation decisions, and claims about the result.

**Pair programmer**:
The persistent advisory partner that follows the main agent's presented work and shares sourced learnings. Its findings are advice, not authorization to act.

**Second opinion**:
An independent view on a consequential question, asked of a colleague in the organization by mail. The main agent sees the question and the answer and keeps responsibility for the decision and its validation.

**Person**:
A lasting top-level Pi session with a stable id, a human name, and a place in an organization. A hired person also has a role. People hold assigned tasks and talk through threads. Also called a peer when one person works with another.

**Role**:
A catalog entry that defines a kind of person: its obligation, what it delivers, its model, and its tool posture. A person's role never changes.

**Intern**:
A one-shot reading helper, `explore` or `research`, that runs one headless process, returns one lossy summary, and exits. It is not a person.

**Model profile**:
A named choice of model and thinking level for a workload. It conveys no permissions or capabilities.
_Avoid_: Permission profile

**Pair finding**:
An observation from the pair programmer about the main agent's work. A concern or blocker requires explicit consideration, but is not itself proof that the work is wrong.

**BTW conversation**:
The operator's private, read-only side conversation about the current work. Its answer joins the main conversation only by explicit operator choice.

### Execution and continuity

**Root session**:
A top-level Pi conversation. Every person is one, including the sessions the operator starts. Interns, the BTW conversation, and forked continuations are not.

**Assignment**:
The record that a person holds a task, given by a manager or taken by the person. Only assignments bind work to a person.

**Pi Exec**:
The harness capability for bounded, type-checked programmatic composition of tools and model work.

**Program peer**:
A person a Pi Exec program attaches, or starts in a role, to run turns that return results to the program. A temporary program peer is discarded when its call or the program ends. It is distinct from the runtime that executes the program.

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
An undertaking with its own intent, status, current state, and outcome. The ledger is its operational workbench; “ledger task” is a qualifier for explaining that relationship, not a separate kind of task. An ephemeral task has the same shape and lives in the state directory until it finishes or is promoted to the ledger.

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
The jobs, running Pi Exec programs, and intern calls presented together for operator inspection. Their shared presentation does not make them one lifecycle or one kind of work.

**Prompt stash**:
The operator's temporary collection of unsubmitted prompts. It is distinct from conversation history and scheduled prompts.

**Input editor**:
The operator's prompt-composition surface with model identity and glanceable session status.

**Terse tool rendering**:
The compact presentation of tool activity with expandable detail. Presentation brevity is distinct from compression of the underlying command output.

**Completion notification**:
An operator-facing signal that a run has settled or attention is required. It is not proof that the requested work succeeded.

**Session status**:
The operator-facing indication that a root session is busy, idle, or waiting for input. An idle session can have unfinished jobs or assigned tasks.

### Session state

**Session state model**:
The single shared account of the operator's Pi sessions, their processes, and tmux that every view and every supervising session reads. Each fact in it carries its source and time.

**Incarnation**:
One process lifetime of a session. Reopening a session starts a new incarnation, possibly in another tmux pane; a command meant for an old incarnation never reaches a new one.
_Avoid_: Instance, run

**Bridge**:
The part of every Pi session that reports the session's activity to the session state model and carries commands back into it.

**Supervision**:
The relation from a session to the session that started it and watches over it, such as a manager and a person it hired.

**Lineage**:
The relation from a session to the session it was forked or cloned from.

**Needs you**:
A session with an open prompt for the operator, or with a new reply since the operator last looked at it.
_Avoid_: Unseen, done

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

# Design It Twice

Your first interface is unlikely to be the best. When a module's interface is worth exploring, a design board produces several radically different designs, attacks the favourite, and the operator chooses. Everyone uses the vocabulary in [SKILL.md](../SKILL.md) and, when present, the project's domain language in `.wiki/`.

## Frame the problem

Whoever runs this process chairs the board. Before staffing it, write the problem space for the chosen module and show it to the operator:

- the constraints any interface must satisfy;
- the dependencies, each with its category from [deepening.md](deepening.md);
- a rough code sketch that makes the constraints concrete. It is not a proposal.

## Staff the board

| Perspective | Default role | Design goal |
| --- | --- | --- |
| Minimal interface | `principal-engineer` | 1–3 entry points, the most leverage per entry point |
| Widest options | `distinguished-member-of-technical-staff` | the design the others would not consider |
| Outside the stack | `paradigm-outsider` | the design without the current conventions |
| Attack | `architecture-prosecutor` | the strongest case against the favourite |

Add or swap a designer when the module needs another lens, such as ports and adapters for cross-seam dependencies, or the most common caller. Staff the whole board with standing people before briefing anyone, and give every member the names of the others.

## Run the board

1. **Designs, alone.** Each designer gets the problem space and its design goal, not the chair's preference, and sends the chair privately: the interface (types, methods, parameters, invariants, ordering, error modes), a caller's usage example, what hides behind the seam, the dependency strategy and adapters, and where leverage is high or thin.
2. **Challenge.** The chair posts all designs, in full, in one `send_mail` thread to the board and names a favourite. The prosecutor attacks it; designers answer.
3. **Compare.** Once every designer has answered the attack, or the board has converged, the chair ends the challenge and compares the designs on depth, locality, and seam placement, and recommends one, or a hybrid when parts combine well. Be opinionated: the operator wants a strong read, not a menu.
4. **Choose.** The chair presents each design, the attack, and the recommendation, together with any question the board found that only the operator can answer, then asks the operator to choose with `ask_user_question`, and records the choice in the task.
5. **Close.** The board spends a short exchange on what made this design harder or easier, and the chair records it in the task's `retrospective.md`.

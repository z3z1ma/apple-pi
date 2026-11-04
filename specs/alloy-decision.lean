/-
Soundness of alloy_check's decision (components/formal-verification/src/alloy.ts,
execute, judge and runAlloy), as built, for any number of commands. Each
command's execution is an input: whether it ran before the deadline, its exit
code and timeout, Alloy's missed-expect line, whether the receipt is a valid
solver result for that command (and if so, whether it found an instance), and
whether the instance text was written. Theorem `pass_sound` states what a
`pass` guarantees.
-/

inductive Kind where
  | check
  | run
  deriving DecidableEq

structure Exec where
  exitCode : Option Int
  timedOut : Bool
  /-- Alloy's "was satisfied" (true) or "was not satisfied" (false) line, if any. -/
  missedLine : Option Bool
  /-- `solverResult`: none unless the receipt is a valid solver result for this command. -/
  receipt : Option Bool
  solutionText : Bool

structure Cmd where
  kind : Kind
  /-- `expect 1` is `some true`, `expect 0` is `some false`. -/
  expected : Option Bool
  /-- none: the deadline passed before the command started. -/
  exec : Option Exec

inductive Result where
  | notRun
  | error
  | found (hasInstance : Bool)
  deriving DecidableEq

/-- `expectationReport` in alloy.ts: Alloy's line counts only for a command that declares `expect`. -/
def missedOf (c : Cmd) (e : Exec) : Option Bool := if c.expected.isSome then e.missedLine else none

/-- The checks `execute` makes once a receipt names a solver result `f`. -/
def accepted (c : Cmd) (e : Exec) (f : Bool) : Bool :=
  (e.exitCode == some 0 || (e.exitCode == some 1 && (missedOf c e).isSome)) &&
  !((missedOf c e).isSome && (e.exitCode != some 1 || missedOf c e != some f || f == (c.expected == some true))) &&
  (!f || e.solutionText)

/-- `execute` in alloy.ts. It checks the exit code before reading the receipt; both failures are
    errors, so checking them together gives the same result. -/
def execute (c : Cmd) : Result :=
  match c.exec with
  | none => .notRun
  | some e =>
    if e.timedOut then .notRun
    else
      match e.receipt with
      | none => .error
      | some f => if accepted c e f then .found f else .error

def outcomeOf (c : Cmd) : Option Bool :=
  match execute c with
  | .found f => some f
  | _ => none

/-- `judge` in alloy.ts passes exactly when this holds. -/
def judgeOk (cmds : List Cmd) : Bool :=
  cmds.all (fun c => (outcomeOf c).isSome) &&
  cmds.all (fun c => match c.expected, outcomeOf c with
    | some x, some f => f == x
    | _, _ => true) &&
  cmds.all (fun c => !(c.kind == .check && c.expected == none && outcomeOf c == some true)) &&
  cmds.all (fun c => !(c.kind == .run && c.expected == none && outcomeOf c == some false)) &&
  cmds.any (fun c => c.kind == .check && c.expected != some true) &&
  cmds.any (fun c => c.kind == .run && c.expected != some false && outcomeOf c == some true)

def runAlloyPasses (listed selected unchanged : Bool) (cmds : List Cmd) : Bool :=
  listed && selected && cmds.all (fun c => execute c != .error) && unchanged && judgeOk cmds

theorem execute_found {c : Cmd} {f : Bool} (h : execute c = .found f) :
    ∃ e, c.exec = some e ∧ e.timedOut = false ∧ e.receipt = some f ∧ (f = true → e.solutionText = true) ∧
      (e.exitCode = some 0 ∨
        (e.exitCode = some 1 ∧ c.expected.isSome ∧ e.missedLine = some f ∧ f ≠ (c.expected == some true))) := by
  unfold execute at h
  cases hx : c.exec with
  | none => simp [hx] at h
  | some e =>
    simp only [hx] at h
    cases ht : e.timedOut <;> simp only [ht, ite_true, Bool.false_eq_true, ite_false] at h
    · cases hr : e.receipt with
      | none => simp [hr] at h
      | some f' =>
        simp only [hr] at h
        cases ha : accepted c e f' <;> simp only [ha, ite_true, Bool.false_eq_true, ite_false] at h
        · contradiction
        · cases h
          refine ⟨e, rfl, ht, hr, ?_⟩
          unfold accepted missedOf at ha
          cases hexp : c.expected.isSome
          · simp [hexp] at ha
            obtain ⟨hcode, hsol⟩ := ha
            exact ⟨fun hf => by cases hsol <;> simp_all, Or.inl hcode⟩
          · simp [hexp] at ha
            obtain ⟨⟨hcode, hmiss⟩, hsol⟩ := ha
            refine ⟨fun hf => by cases hsol <;> simp_all, ?_⟩
            rcases hmiss with hnone | ⟨⟨h1, hml⟩, hne⟩
            · rcases hcode with h0 | ⟨_, hs⟩
              · exact Or.inl h0
              · simp [hnone] at hs
            · exact Or.inr ⟨h1, rfl, hml, hne⟩
    · contradiction

/-- What a `pass` from alloy_check guarantees, for any list of commands. -/
theorem pass_sound (listed selected unchanged : Bool) (cmds : List Cmd)
    (h : runAlloyPasses listed selected unchanged cmds = true) :
    listed = true ∧ selected = true ∧ unchanged = true ∧
    (∀ c ∈ cmds, ∃ e f, c.exec = some e ∧ e.timedOut = false ∧ e.exitCode = some 0 ∧
      e.receipt = some f ∧ outcomeOf c = some f ∧
      (c.kind = .check → c.expected = none → f = false) ∧
      (c.kind = .run → c.expected = none → f = true) ∧
      (∀ x, c.expected = some x → f = x)) ∧
    (∃ c ∈ cmds, c.kind = .check ∧ c.expected ≠ some true) ∧
    (∃ c ∈ cmds, c.kind = .run ∧ c.expected ≠ some false ∧ outcomeOf c = some true) := by
  simp only [runAlloyPasses, judgeOk, Bool.and_eq_true, and_assoc, List.all_eq_true,
    List.any_eq_true] at h
  obtain ⟨hl, hs, _, hu, hsome, hexp, hcheck, hrun, ⟨p, hp, hpk⟩, ⟨w, hw, hwk⟩⟩ := h
  refine ⟨hl, hs, hu, ?_, ⟨p, hp, by simpa using hpk⟩, ⟨w, hw, by simpa using hwk⟩⟩
  intro c hc
  have hs' := hsome c hc
  cases ho : outcomeOf c with
  | none => simp [ho] at hs'
  | some f =>
    have hf : execute c = .found f := by
      unfold outcomeOf at ho
      split at ho <;> simp_all
    obtain ⟨e, he, ht, hr, _, hx⟩ := execute_found hf
    have hmet : ∀ x, c.expected = some x → f = x := by
      intro x hx'
      have := hexp c hc
      simp [hx', ho] at this
      exact this
    have hcode : e.exitCode = some 0 := by
      rcases hx with h0 | ⟨_, hsomeExp, _, hne⟩
      · exact h0
      · obtain ⟨x, hxe⟩ := Option.isSome_iff_exists.mp hsomeExp
        have := hmet x hxe
        subst this
        cases f <;> simp_all
    refine ⟨e, f, he, ht, hcode, hr, rfl, ?_, ?_, hmet⟩
    · intro hk hn
      have := hcheck c hc
      cases f <;> simp_all
    · intro hk hn
      have := hrun c hc
      cases f <;> simp_all

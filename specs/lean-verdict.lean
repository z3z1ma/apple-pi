/-
Soundness of lean_check's decision (components/formal-verification/src/lean.ts,
runLean and summary), as built. Every phase result is an input: each process's
exit code and timeout, whether Lean's output parsed as JSON, the diagnostics,
whether the audit wrote a valid report, the report's declarations and the
kernel replay. runLean returns early on the first failed phase and otherwise
returns summary's verdict; the order of the early returns decides which failure
is reported, not whether the verdict is `pass`. Theorem `pass_sound` states
what a `pass` guarantees for every possible run.
-/

inductive Failure where
  | error
  | incomplete

inductive Verdict where
  | pass
  | fail (f : Failure)

structure Proc where
  exitCode : Option Int
  timedOut : Bool

/-- `failure()` in lean.ts returns nothing exactly when this holds. -/
def Proc.ok (p : Proc) : Bool := !p.timedOut && p.exitCode == some 0

def Proc.failure (p : Proc) : Failure := if p.timedOut then .incomplete else .error

inductive Severity where
  | error
  | warning
  | information
  deriving DecidableEq

structure Diagnostic where
  severity : Severity
  usesSorry : Bool

inductive Kind where
  | theorem
  | axiom
  | other
  deriving DecidableEq

structure Axiom where
  name : String
  fromToolchain : Bool

structure Decl where
  name : String
  kind : Kind
  written : Bool
  axioms : List Axiom

def standard (a : Axiom) : Bool :=
  a.fromToolchain && (a.name == "propext" || a.name == "Classical.choice" || a.name == "Quot.sound")

def sorryFree (d : Decl) : Bool := d.axioms.all (·.name != "sorryAx")

def trusted (d : Decl) : Bool := d.axioms.all standard

structure Run where
  prepared : Proc
  build : Option Proc
  lakeEnv : Option Proc
  compile : Proc
  diagnostics : Option (List Diagnostic)
  audit : Proc
  report : Option (List Decl)
  replay : Proc
  wanted : List String

/-- `audit` in lean.ts for one requested name: an unambiguous theorem, or a problem. -/
def resolve (decls : List Decl) (name : String) : Option Decl :=
  match decls.filter (·.name == name) with
  | [d] => if d.kind == .theorem then some d else none
  | _ => none

/-- The audited theorems: the named ones, or every written theorem. -/
def audited (decls : List Decl) (wanted : List String) : List (Option Decl) :=
  if wanted.isEmpty then (decls.filter (fun d => d.kind == .theorem && d.written)).map some
  else wanted.map (resolve decls)

/-- The theorems whose axioms must be standard: all of them by default, else the named ones. -/
def covered (decls : List Decl) (wanted : List String) : List Decl :=
  if wanted.isEmpty then decls.filter (·.kind == .theorem) else (audited decls wanted).filterMap id

/-- `summary` in lean.ts passes exactly when this holds. -/
def summaryOk (decls : List Decl) (diags : List Diagnostic) (wanted : List String) : Bool :=
  decls.all sorryFree && !(diags.any (·.usesSorry)) && (covered decls wanted).all trusted &&
  !((audited decls wanted).any Option.isNone) && !(audited decls wanted).isEmpty

/-- Every early return in runLean is skipped exactly when this holds. -/
def phasesOk (r : Run) : Bool :=
  r.prepared.ok && r.build.all Proc.ok && r.lakeEnv.all Proc.ok && r.compile.ok && r.audit.ok &&
  r.replay.ok && r.report.isSome &&
  match r.diagnostics with
  | some ds => !(ds.any (·.severity == .error))
  | none => false

def runLean (r : Run) : Verdict :=
  if phasesOk r && summaryOk (r.report.getD []) (r.diagnostics.getD []) r.wanted then .pass
  else .fail (if phasesOk r then .incomplete else r.compile.failure)

theorem resolve_theorem {decls : List Decl} {n : String} {d : Decl} (h : resolve decls n = some d) :
    d.kind = .theorem := by
  unfold resolve at h
  split at h
  · split at h
    · rename_i hk
      cases h
      simpa using hk
    · contradiction
  · contradiction

theorem summary_sound {decls : List Decl} {diags : List Diagnostic} {wanted : List String}
    (h : summaryOk decls diags wanted = true) :
    (∀ d ∈ decls, ∀ a ∈ d.axioms, a.name ≠ "sorryAx") ∧
    (∀ g ∈ diags, g.usesSorry = false) ∧
    (wanted = [] →
      (∀ d ∈ decls, d.kind = .theorem → ∀ a ∈ d.axioms, standard a = true) ∧
      ∃ d ∈ decls, d.kind = .theorem ∧ d.written = true) ∧
    (∀ n ∈ wanted, ∃ d, resolve decls n = some d ∧ d.kind = .theorem ∧
      ∀ a ∈ d.axioms, standard a = true) := by
  simp only [summaryOk, Bool.and_eq_true, and_assoc, Bool.not_eq_true', List.all_eq_true,
    List.any_eq_false, sorryFree, trusted, bne_iff_ne, ne_eq] at h
  obtain ⟨hs, hw, hc, hnone, he⟩ := h
  refine ⟨hs, fun g hg => by simpa using hw g hg, ?_, ?_⟩
  · intro hnil
    subst hnil
    simp only [covered, audited, List.isEmpty_nil, ite_true, List.mem_filter, beq_iff_eq] at hc he
    refine ⟨fun d hd hk a ha => hc d ⟨hd, hk⟩ a ha, ?_⟩
    have hne : decls.filter (fun d => d.kind == .theorem && d.written) ≠ [] := by
      intro hnil
      simp [hnil] at he
    obtain ⟨d, hd⟩ := List.exists_mem_of_ne_nil _ hne
    have hm := List.mem_filter.mp hd
    simp only [Bool.and_eq_true, beq_iff_eq] at hm
    exact ⟨d, hm.1, hm.2.1, hm.2.2⟩
  · intro n hn
    have hne : wanted.isEmpty = false := by
      cases wanted with
      | nil => simp at hn
      | cons _ _ => rfl
    simp only [covered, audited, hne, Bool.false_eq_true, ite_false] at hc hnone
    cases hres : resolve decls n with
    | none =>
      have := hnone none (List.mem_map.mpr ⟨n, hn, hres⟩)
      simp at this
    | some d =>
      exact ⟨d, rfl, resolve_theorem hres,
        hc d (List.mem_filterMap.mpr ⟨some d, List.mem_map.mpr ⟨n, hn, hres⟩, rfl⟩)⟩

/-- What a `pass` from lean_check guarantees, for every possible run. -/
theorem pass_sound (r : Run) (h : runLean r = .pass) :
    r.prepared.ok = true ∧ (∀ b ∈ r.build, b.ok = true) ∧ (∀ e ∈ r.lakeEnv, e.ok = true) ∧
    r.compile.ok = true ∧ r.audit.ok = true ∧ r.replay.ok = true ∧
    (∃ diags, r.diagnostics = some diags ∧ ∀ g ∈ diags, g.severity ≠ .error ∧ g.usesSorry = false) ∧
    ∃ decls, r.report = some decls ∧
      (∀ d ∈ decls, ∀ a ∈ d.axioms, a.name ≠ "sorryAx") ∧
      (r.wanted = [] →
        (∀ d ∈ decls, d.kind = .theorem → ∀ a ∈ d.axioms, standard a = true) ∧
        ∃ d ∈ decls, d.kind = .theorem ∧ d.written = true) ∧
      (∀ n ∈ r.wanted, ∃ d, resolve decls n = some d ∧ d.kind = .theorem ∧
        ∀ a ∈ d.axioms, standard a = true) := by
  have hok : phasesOk r = true ∧ summaryOk (r.report.getD []) (r.diagnostics.getD []) r.wanted = true := by
    unfold runLean at h
    split at h
    · rename_i hc
      simpa [Bool.and_eq_true] using hc
    · contradiction
  obtain ⟨hp, hs⟩ := hok
  simp only [phasesOk, Bool.and_eq_true, and_assoc] at hp
  obtain ⟨hprep, hbuild, henv, hcomp, haud, hrep, hreport, hdiag⟩ := hp
  obtain ⟨diags, hds⟩ : ∃ ds, r.diagnostics = some ds := by
    cases hd : r.diagnostics <;> simp_all
  obtain ⟨decls, hdecls⟩ : ∃ ds, r.report = some ds := by
    cases hd : r.report <;> simp_all
  rw [hds] at hdiag hs
  rw [hdecls] at hs
  simp only [Option.getD_some] at hs
  obtain ⟨s1, s2, s3, s4⟩ := summary_sound hs
  simp only [Bool.not_eq_true', List.any_eq_false, beq_iff_eq] at hdiag
  refine ⟨hprep, ?_, ?_, hcomp, haud, hrep, ⟨diags, hds, fun g hg => ⟨hdiag g hg, s2 g hg⟩⟩,
    decls, hdecls, s1, s3, s4⟩
  · intro b hb
    rw [Option.mem_def] at hb
    rw [hb] at hbuild
    simpa using hbuild
  · intro e he
    rw [Option.mem_def] at he
    rw [he] at henv
    simpa using henv

/-- A diagnostic that reports sorry never lets a run pass. -/
theorem sorry_warning_never_passes (r : Run) (diags : List Diagnostic) (g : Diagnostic)
    (hd : r.diagnostics = some diags) (hg : g ∈ diags) (hs : g.usesSorry = true) :
    runLean r ≠ .pass := by
  intro h
  obtain ⟨_, _, _, _, _, _, ⟨ds, hds, hall⟩, _⟩ := pass_sound r h
  rw [hd] at hds
  cases hds
  simp_all

/-- A failed or stopped kernel replay never lets a run pass. -/
theorem failed_replay_never_passes (r : Run) (hr : r.replay.ok = false) : runLean r ≠ .pass := by
  intro h
  obtain ⟨_, _, _, _, _, hok, _⟩ := pass_sound r h
  simp_all

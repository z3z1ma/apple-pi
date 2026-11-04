/-
Reference model of the default-selection verdict in
components/formal-verification/src/lean.ts (`summary`), proved sound:
whenever it says `pass`, no declaration depends on `sorryAx`, every theorem
uses only the standard axioms from the toolchain, and some written theorem
was audited.
-/

inductive Kind where
  | theorem
  | axiom
  | other
  deriving DecidableEq

structure Axiom where
  name : String
  fromToolchain : Bool

structure Decl where
  kind : Kind
  written : Bool
  axioms : List Axiom

inductive Verdict where
  | pass
  | incomplete
  deriving DecidableEq

def standard (a : Axiom) : Bool :=
  a.fromToolchain && (a.name == "propext" || a.name == "Classical.choice" || a.name == "Quot.sound")

def usesSorry (d : Decl) : Bool := d.axioms.any (·.name == "sorryAx")

def trusting (d : Decl) : Bool := d.kind == .theorem && d.axioms.any (!standard ·)

def listed (d : Decl) : Bool := d.kind == .theorem && d.written

def verdict (decls : List Decl) (sorryWarning : Bool) : Verdict :=
  if decls.any usesSorry || sorryWarning then .incomplete
  else if decls.any trusting then .incomplete
  else if !(decls.any listed) then .incomplete
  else .pass

theorem pass_has_no_sorry (decls : List Decl) (w : Bool) (h : verdict decls w = .pass) :
    ∀ d ∈ decls, ∀ a ∈ d.axioms, a.name ≠ "sorryAx" := by
  intro d hd a ha hname
  unfold verdict at h
  have : decls.any usesSorry = true :=
    List.any_eq_true.mpr ⟨d, hd, List.any_eq_true.mpr ⟨a, ha, by simp [hname]⟩⟩
  simp [this] at h

theorem pass_has_only_standard_axioms (decls : List Decl) (w : Bool) (h : verdict decls w = .pass) :
    ∀ d ∈ decls, d.kind = .theorem → ∀ a ∈ d.axioms, standard a = true := by
  intro d hd hk a ha
  cases hs : standard a
  · have : decls.any trusting = true :=
      List.any_eq_true.mpr ⟨d, hd, by simp [trusting, hk]; exact ⟨a, ha, hs⟩⟩
    unfold verdict at h
    split at h <;> simp_all
  · rfl

theorem pass_audits_a_written_theorem (decls : List Decl) (w : Bool) (h : verdict decls w = .pass) :
    ∃ d ∈ decls, d.kind = .theorem ∧ d.written = true := by
  unfold verdict at h
  split at h
  · contradiction
  · split at h
    · contradiction
    · split at h
      · contradiction
      · rename_i hl
        simp only [Bool.not_eq_true', Bool.not_eq_false] at hl
        obtain ⟨d, hd, hdl⟩ := List.any_eq_true.mp (by simpa using hl)
        exact ⟨d, hd, by simp_all [listed]⟩

theorem sorry_warning_never_passes (decls : List Decl) : verdict decls true ≠ .pass := by
  simp [verdict]

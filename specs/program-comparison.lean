/-
  compare.ts comparePrograms: the order of runs. Every round runs every task
  in both arms, the arm that goes first alternating by round. Claim, from
  ticket 04: both arms of every task get exactly `samples` runs, and the whole
  schedule is 2 * samples * tasks runs.

  replay.ts replayRule: how jobs are counted. A job the engine could not run
  is not evaluated; every other job is evaluated, and a hit is an evaluated job
  with at least one matching line. Claim, from ticket 02: evaluated and not
  evaluated jobs partition the jobs, and every hit is evaluated, so nothing
  the engine could not run is counted as allowed.
-/

inductive Arm where
  | withProgram
  | without
  deriving DecidableEq

def armsOf (round : Nat) : List Arm :=
  if round % 2 = 1 then [Arm.without, Arm.withProgram] else [Arm.withProgram, Arm.without]

def perRound (round tasks : Nat) : List (Nat × Arm) :=
  (List.range tasks).flatMap fun task => (armsOf round).map fun arm => (task, arm)

def schedule (samples tasks : Nat) : List (Nat × Arm) :=
  (List.range samples).flatMap fun round => perRound round tasks

theorem armsOf_count (round : Nat) (arm : Arm) : (armsOf round).count arm = 1 := by
  unfold armsOf
  split <;> cases arm <;> decide

theorem block_count_other (round task other : Nat) (arm : Arm) (h : other ≠ task) :
    (((armsOf round).map fun a => (other, a)).count (task, arm)) = 0 := by
  rw [List.count_eq_zero]
  intro hm
  rw [List.mem_map] at hm
  obtain ⟨a, _, ha⟩ := hm
  simp at ha
  exact h ha.1

theorem block_count_same (round task : Nat) (arm : Arm) :
    (((armsOf round).map fun a => (task, a)).count (task, arm)) = 1 := by
  unfold armsOf
  split <;> cases arm <;> simp

theorem perRound_count_beyond (round task : Nat) (arm : Arm) :
    ∀ tasks, tasks ≤ task → (perRound round tasks).count (task, arm) = 0 := by
  intro tasks
  induction tasks with
  | zero => intro _; simp [perRound]
  | succ n ih =>
    intro h
    have hn : n ≠ task := by omega
    have prev := ih (by omega)
    simp only [perRound, List.range_succ, List.flatMap_append, List.count_append] at prev ⊢
    simp only [List.flatMap_cons, List.flatMap_nil, List.append_nil]
    rw [prev, block_count_other round task n arm hn]

theorem perRound_count (round task : Nat) (arm : Arm) :
    ∀ tasks, task < tasks → (perRound round tasks).count (task, arm) = 1 := by
  intro tasks
  induction tasks with
  | zero => intro h; omega
  | succ n ih =>
    intro h
    simp only [perRound, List.range_succ, List.flatMap_append, List.count_append,
      List.flatMap_cons, List.flatMap_nil, List.append_nil]
    by_cases hlt : task < n
    · have prev := ih hlt
      simp only [perRound] at prev
      rw [prev, block_count_other round task n arm (by omega)]
    · have heq : n = task := by omega
      subst heq
      have none := perRound_count_beyond round n arm n (Nat.le_refl n)
      simp only [perRound] at none
      rw [none, block_count_same]

theorem schedule_count (samples tasks task : Nat) (arm : Arm) (h : task < tasks) :
    (schedule samples tasks).count (task, arm) = samples := by
  induction samples with
  | zero => simp [schedule]
  | succ n ih =>
    simp only [schedule, List.range_succ, List.flatMap_append, List.count_append,
      List.flatMap_cons, List.flatMap_nil, List.append_nil] at ih ⊢
    rw [ih, perRound_count n task arm tasks h]

theorem perRound_length (round tasks : Nat) : (perRound round tasks).length = 2 * tasks := by
  induction tasks with
  | zero => simp [perRound]
  | succ n ih =>
    simp only [perRound, List.range_succ, List.flatMap_append, List.length_append,
      List.flatMap_cons, List.flatMap_nil, List.append_nil, List.length_map] at ih ⊢
    rw [ih]
    unfold armsOf
    split <;> simp <;> omega

theorem schedule_length (samples tasks : Nat) :
    (schedule samples tasks).length = 2 * samples * tasks := by
  induction samples with
  | zero => simp [schedule]
  | succ n ih =>
    simp only [schedule, List.range_succ, List.flatMap_append, List.length_append,
      List.flatMap_cons, List.flatMap_nil, List.append_nil] at ih ⊢
    rw [ih, perRound_length]
    rw [Nat.mul_succ, Nat.add_mul]

inductive Run where
  | failure
  | lines (count : Nat)

def evaluated : List Run → Nat
  | [] => 0
  | Run.failure :: rest => evaluated rest
  | Run.lines _ :: rest => evaluated rest + 1

def notEvaluated : List Run → Nat
  | [] => 0
  | Run.failure :: rest => notEvaluated rest + 1
  | Run.lines _ :: rest => notEvaluated rest

def hits : List Run → Nat
  | [] => 0
  | Run.failure :: rest => hits rest
  | Run.lines n :: rest => if n > 0 then hits rest + 1 else hits rest

theorem replay_partition (runs : List Run) : evaluated runs + notEvaluated runs = runs.length := by
  induction runs with
  | nil => rfl
  | cons run rest ih =>
    cases run <;> simp [evaluated, notEvaluated] <;> omega

theorem hits_are_evaluated (runs : List Run) : hits runs ≤ evaluated runs := by
  induction runs with
  | nil => simp [hits, evaluated]
  | cons run rest ih =>
    cases run with
    | failure => simp [hits, evaluated]; exact ih
    | lines n =>
      simp only [hits, evaluated]
      split <;> omega

theorem failures_never_hit (rest : List Run) : hits (Run.failure :: rest) = hits rest := rfl

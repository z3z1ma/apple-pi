def merge (a b : Nat) : Nat := max a b

theorem merge_comm (a b : Nat) : merge a b = merge b a := by
  simp [merge, Nat.max_comm]

theorem merge_assoc (a b c : Nat) : merge (merge a b) c = merge a (merge b c) := by
  simp [merge, Nat.max_assoc]

theorem merge_idem (a : Nat) : merge a a = a := by
  simp [merge]

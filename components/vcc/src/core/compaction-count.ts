/**
 * Count pi-vcc compactions in the session.
 *
 * Compaction entries are persisted to the session file as
 * `{ type: "compaction", details: { compactor: "pi-vcc", ... } }`.
 * `session_compact` fires after the new compaction entry has been appended,
 * so counting entries at that point includes the just-completed compaction —
 * meaning the count doubles as the 1-based ordinal of the latest one.
 *
 * `getEntries()` returns the full append-only session (all lineages), which
 * matches the `compaction:N` indexing scheme used by vcc_recall — so the
 * ordinal shown in the notification lines up with `scope:"compaction:N"`.
 */

export const ordinalSuffix = (n: number): string => {
  const last = n % 10;
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  if (last === 1) return "st";
  if (last === 2) return "nd";
  if (last === 3) return "rd";
  return "th";
};

interface SessionManagerLike {
  getEntries?: () => any[];
}

/** Total pi-vcc compactions in the session (includes the just-completed one). */
export const countPiVccCompactions = (entries: any[]): number => {
  let total = 0;
  for (const e of entries) {
    if (e?.type === "compaction" && e?.details?.compactor === "pi-vcc") total++;
  }
  return total;
};

export const countPiVccCompactionsFromSession = (sessionManager: SessionManagerLike | undefined): number => {
  try {
    const entries = sessionManager?.getEntries?.() ?? [];
    return countPiVccCompactions(entries);
  } catch {
    return 0;
  }
};

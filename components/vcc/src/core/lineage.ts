interface LineageEntryLike {
  id?: string;
}

interface LineageSessionManagerLike {
  getBranch: () => LineageEntryLike[];
  getEntries?: () => LineageEntryLike[];
}

export const getActiveLineageEntryIds = (sessionManager: LineageSessionManagerLike): Set<string> => {
  try {
    const branch = sessionManager.getBranch() ?? [];
    if (branch.length > 0) {
      return new Set(branch.map((e) => e.id).filter((id): id is string => Boolean(id)));
    }
  } catch {
    // fall through to defensive fallback
  }

  try {
    const all = sessionManager.getEntries?.() ?? [];
    return new Set(all.map((e) => e.id).filter((id): id is string => Boolean(id)));
  } catch {
    return new Set();
  }
};

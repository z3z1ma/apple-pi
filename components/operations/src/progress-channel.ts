export type ProgressListener<T> = (snapshot: T) => void;

export interface SequencedSnapshot {
	runId: string;
	sequence: number;
}

function cloneSnapshot<T>(snapshot: T): T {
	return structuredClone(snapshot);
}

function notify(listener: ProgressListener<never>, snapshot: never): void {
	try {
		listener(snapshot);
	} catch {
		// Subscriber faults stay in the projection. They must not fail a run or other listeners.
	}
}

/** Per-run monotonic progress fan-out with immediate replay and isolated listeners. */
export class ProgressChannel<T extends SequencedSnapshot> {
	private readonly latest = new Map<string, T>();
	private readonly sequences = new Map<string, number>();
	private readonly listeners = new Set<ProgressListener<T>>();

	nextSequence(runId: string): number {
		const next = (this.sequences.get(runId) ?? 0) + 1;
		this.sequences.set(runId, next);
		return next;
	}

	current(runId: string): T | undefined {
		const snapshot = this.latest.get(runId);
		return snapshot ? cloneSnapshot(snapshot) : undefined;
	}

	list(): T[] {
		return [...this.latest.values()].map((snapshot) => cloneSnapshot(snapshot));
	}

	publish(snapshot: T): T {
		const cloned = cloneSnapshot(snapshot);
		this.sequences.set(cloned.runId, cloned.sequence);
		this.latest.set(cloned.runId, cloned);
		for (const listener of this.listeners) notify(listener, cloneSnapshot(cloned) as never);
		return cloneSnapshot(cloned);
	}

	subscribe(listener: ProgressListener<T>): () => void {
		this.listeners.add(listener);
		for (const snapshot of this.latest.values()) notify(listener, cloneSnapshot(snapshot) as never);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.listeners.delete(listener);
		};
	}

	drop(runId: string): void {
		this.latest.delete(runId);
		this.sequences.delete(runId);
	}
}

export type SnapshotApplyResult<T> = { ok: true; snapshot: T } | { ok: false; error: string; runId: string };

/** Rejects identity mutation and sequence regressions for a live projection. */
export class SnapshotProjection<T extends SequencedSnapshot> {
	private readonly snapshots = new Map<string, T>();

	constructor(private readonly identity: (snapshot: T) => string) {}

	get(runId: string): T | undefined {
		const snapshot = this.snapshots.get(runId);
		return snapshot ? cloneSnapshot(snapshot) : undefined;
	}

	list(): T[] {
		return [...this.snapshots.values()].map((snapshot) => cloneSnapshot(snapshot));
	}

	apply(snapshot: T): SnapshotApplyResult<T> {
		const existing = this.snapshots.get(snapshot.runId);
		if (existing) {
			if (this.identity(existing) !== this.identity(snapshot)) {
				return {
					ok: false,
					runId: snapshot.runId,
					error: `Progress snapshot changed immutable identity for ${snapshot.runId}`,
				};
			}
			if (snapshot.sequence <= existing.sequence) {
				return {
					ok: false,
					runId: snapshot.runId,
					error: `Progress sequence regressed for ${snapshot.runId}: ${snapshot.sequence} <= ${existing.sequence}`,
				};
			}
		}
		const cloned = cloneSnapshot(snapshot);
		this.snapshots.set(snapshot.runId, cloned);
		return { ok: true, snapshot: cloneSnapshot(cloned) };
	}

	delete(runId: string): void {
		this.snapshots.delete(runId);
	}
}

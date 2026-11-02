/**
 * Unsent words kept on this device: each entry is its own localStorage key under `prefix`, so a draft survives a
 * reload or relaunch, and two documents (Workplace and its World frame) never overwrite each other's drafts.
 */
export class StoredDrafts extends Map<string, string> {
	private readonly prefix: string;

	constructor(prefix: string) {
		super();
		this.prefix = prefix;
		try {
			for (let index = 0; index < localStorage.length; index++) {
				const key = localStorage.key(index);
				const value = key?.startsWith(prefix) ? localStorage.getItem(key) : null;
				if (key && value) super.set(key.slice(prefix.length), value);
			}
		} catch {
			// Storage refused (a private window): drafts live only in memory, as before.
		}
	}

	override set(key: string, value: string): this {
		if (!value) {
			this.delete(key);
			return this;
		}
		super.set(key, value);
		try {
			localStorage.setItem(this.prefix + key, value);
		} catch {}
		return this;
	}

	override delete(key: string): boolean {
		try {
			localStorage.removeItem(this.prefix + key);
		} catch {}
		return super.delete(key);
	}
}

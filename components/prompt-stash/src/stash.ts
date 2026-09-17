export interface StashPushResult {
	evicted?: string;
	size: number;
}

export interface StashedPrompt {
	text: string;
	createdAt: number;
}

export const DEFAULT_STASH_CAPACITY = 20;

/**
 * In-memory bounded stack for stashed editor prompts with FIFO eviction.
 */
export class PromptStash {
	private readonly capacity: number;
	private items: StashedPrompt[] = [];

	constructor(capacity: number = DEFAULT_STASH_CAPACITY) {
		this.capacity = Math.max(1, capacity);
	}

	getCapacity(): number {
		return this.capacity;
	}

	size(): number {
		return this.items.length;
	}

	isEmpty(): boolean {
		return this.items.length === 0;
	}

	push(text: string): StashPushResult | false {
		const trimmed = text.trim();
		if (!trimmed) {
			return false;
		}

		let evicted: string | undefined;
		if (this.items.length >= this.capacity) {
			evicted = this.items.shift()?.text;
		}

		this.items.push({
			text,
			createdAt: Date.now(),
		});

		return {
			evicted,
			size: this.items.length,
		};
	}

	pop(): string | undefined {
		return this.items.pop()?.text;
	}

	peek(): string | undefined {
		return this.items[this.items.length - 1]?.text;
	}

	drop(index?: number): string | undefined {
		if (this.items.length === 0) {
			return undefined;
		}
		if (index === undefined) {
			return this.items.pop()?.text;
		}
		if (index < 0 || index >= this.items.length) {
			return undefined;
		}
		return this.items.splice(index, 1)[0]?.text;
	}

	clear(): void {
		this.items = [];
	}

	list(): readonly StashedPrompt[] {
		return [...this.items];
	}

	get(index: number): StashedPrompt | undefined {
		return this.items[index];
	}
}

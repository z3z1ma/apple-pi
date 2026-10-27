/** Recognizes complete non-ping SSE events without retaining event data. */
export class SseProgress {
	private readonly decoder = new TextDecoder();
	private field: string | null = "";
	private inValue = false;
	private valueLength = 0;
	private matchesPing = true;
	private firstValueCharacter = true;
	private nonemptyLine = false;
	private afterCr = false;
	private hasData = false;
	private ping = false;

	private readonly progress: () => void;

	constructor(progress: () => void) {
		this.progress = progress;
	}

	write(chunk: Uint8Array): void {
		for (const char of this.decoder.decode(chunk, { stream: true })) {
			if (this.afterCr && char === "\n") {
				this.afterCr = false;
				continue;
			}
			this.afterCr = char === "\r";
			if (char === "\r" || char === "\n") {
				if (!this.nonemptyLine) {
					if (this.hasData && !this.ping) this.progress();
					this.hasData = false;
					this.ping = false;
				} else if (this.field === "event") {
					this.ping = this.matchesPing && this.valueLength === 4;
				} else if (this.field === "data") {
					this.hasData = true;
				}
				this.field = "";
				this.inValue = false;
				this.valueLength = 0;
				this.matchesPing = true;
				this.firstValueCharacter = true;
				this.nonemptyLine = false;
				continue;
			}
			this.nonemptyLine = true;
			if (!this.inValue) {
				if (char === ":") this.inValue = true;
				else if (this.field !== null) {
					const next = this.field + char;
					this.field = "event".startsWith(next) || "data".startsWith(next) ? next : null;
				}
			} else if (this.field === "event") {
				if (this.firstValueCharacter && char === " ") {
					this.firstValueCharacter = false;
					continue;
				}
				this.firstValueCharacter = false;
				this.matchesPing &&= char === "ping"[this.valueLength];
				this.valueLength++;
			}
		}
	}
}

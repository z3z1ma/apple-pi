// One panel over the world at a time: the conversation panel and every function place's panels (the inn's and the
// rookery's, the town square's, the forge's, the quest office's and the library's). Each store says here how its panel
// closes, and calls `opening` as it opens one, which closes every other. Without it a panel opened over another (from
// the side panel, or a walk that ends while another panel is up) left the first one's state behind, and it came back
// when the second closed. A leaf module, so the stores can import it without importing each other.

const closers = new Map<string, () => void>();

export const onePanel = {
	/** How the panels of `kind` close; a store registers this once, as it loads. */
	closes(kind: string, close: () => void) {
		closers.set(kind, close);
	},
	/** A panel of `kind` is opening: every other kind closes. */
	opening(kind: string) {
		for (const [other, close] of closers) if (other !== kind) close();
	},
};

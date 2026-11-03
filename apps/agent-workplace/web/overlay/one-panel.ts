const closers = new Map<string, () => void>();

export const onePanel = {
	closes(kind: string, close: () => void) {
		closers.set(kind, close);
	},

	opening(kind: string) {
		for (const [other, close] of closers) if (other !== kind) close();
	},
};

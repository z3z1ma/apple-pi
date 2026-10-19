// PROTOTYPE: small helpers shared by the scenes.
export function hash(text) {
	let h = 2166136261;
	for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return h >>> 0;
}

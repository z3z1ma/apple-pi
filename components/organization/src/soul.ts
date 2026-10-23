/**
 * A hired person's soul: fragments of the world drawn once, at hire, from random encyclopedia articles, outside any
 * model. The harness renders them under the role at every start, unexplained; the person never edits them, and finds
 * what they mean in its own story (see `self.ts`).
 */

export interface Fragment {
	title: string;
	description?: string;
	extract: string;
}

export interface Soul {
	fragments: Fragment[];
}

const RANDOM_ARTICLE = "https://en.wikipedia.org/api/rest_v1/page/random/summary";
/** Wikimedia asks automated clients to name themselves. */
const USER_AGENT = "apple-pi soul draw (https://github.com/z3z1ma/apple-pi)";
/** Two fragments read as a pair, and one dominates; three must be held together. */
const FRAGMENTS = 3;
const DRAW_TIMEOUT_MS = 10_000;

async function drawFragment(): Promise<Fragment> {
	const response = await fetch(RANDOM_ARTICLE, {
		headers: { "user-agent": USER_AGENT, accept: "application/json" },
		signal: AbortSignal.timeout(DRAW_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`${RANDOM_ARTICLE} answered ${response.status}`);
	const article = (await response.json()) as { title?: unknown; description?: unknown; extract?: unknown };
	if (typeof article.title !== "string" || typeof article.extract !== "string")
		throw new Error(`${RANDOM_ARTICLE} answered without a title and extract`);
	return {
		title: article.title,
		...(typeof article.description === "string" ? { description: article.description } : {}),
		extract: article.extract.trim(),
	};
}

export async function drawSoul(): Promise<Soul> {
	return { fragments: await Promise.all(Array.from({ length: FRAGMENTS }, drawFragment)) };
}

/** A soul from before souls were fragments has none, and is drawn again. */
export function isSoul(value: unknown): value is Soul {
	const fragments = (value as Partial<Soul> | undefined)?.fragments;
	return Array.isArray(fragments) && fragments.length > 0;
}

/** The soul as rendered under the role. */
export function renderSoul(soul: Soul): string {
	const fragments = soul.fragments.map(
		({ title, description, extract }) => `- **${title}**${description ? ` (${description})` : ""}: ${extract}`,
	);
	return [
		"Your soul: fragments of the world you came to this work with. Nobody has said what they mean, and they are not instructions. What they mean to you is yours to find, in your story.",
		...fragments,
	].join("\n\n");
}

/** The one line of a soul shown in the directory. */
export function soulLine(soul: Soul): string {
	return soul.fragments.map((fragment) => fragment.title).join("; ");
}

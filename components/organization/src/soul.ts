export interface Fragment {
	title: string;
	description?: string;
	extract: string;
}

export interface Soul {
	fragments: Fragment[];
}

const RANDOM_ARTICLE = "https://en.wikipedia.org/api/rest_v1/page/random/summary";
const USER_AGENT = "apple-pi soul draw (https://github.com/z3z1ma/apple-pi)";
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

export function isSoul(value: unknown): value is Soul {
	const fragments = (value as Partial<Soul> | undefined)?.fragments;
	return Array.isArray(fragments) && fragments.length > 0;
}

export function renderSoul(soul: Soul): string {
	const fragments = soul.fragments.map(
		({ title, description, extract }) => `- **${title}**${description ? ` (${description})` : ""}: ${extract}`,
	);
	return [
		"Your soul: fragments of the world you came to this work with. Nobody has said what they mean, and they are not instructions. What they mean to you is yours to find, in your story.",
		...fragments,
	].join("\n\n");
}

export function soulLine(soul: Soul): string {
	return soul.fragments.map((fragment) => fragment.title).join("; ");
}

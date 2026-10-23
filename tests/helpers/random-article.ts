/**
 * Every suite runs offline: a soul's random-article requests get a numbered fake article, and other requests pass
 * through. A test that needs a failing draw stubs `fetch` itself.
 */

const RANDOM_ARTICLE = "https://en.wikipedia.org/api/rest_v1/page/random/summary";
const realFetch = globalThis.fetch;
let drawn = 0;

globalThis.fetch = (input, init) => {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	if (url !== RANDOM_ARTICLE) return realFetch(input, init);
	drawn++;
	return Promise.resolve(
		Response.json({ title: `Article ${drawn}`, description: "Fake article", extract: `Fact number ${drawn}.` }),
	);
};

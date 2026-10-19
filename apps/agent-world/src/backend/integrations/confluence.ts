// The library's Confluence: CQL text search across every space (v1 GET /wiki/rest/api/search, which v2 has no
// equivalent of), a page's rendered body (v2 GET /wiki/api/v2/pages/{id}?body-format=view), and a local list of pages
// opened recently, kept in a private file beside the credentials. Read-only: Agent World never writes to Confluence.
import { existsSync, readFileSync } from "node:fs";
import type { ConfluencePage, ConfluencePageRef, Outcome, RecentPage } from "../../integrations.js";
import { atlassianRequest, type Fetch, htmlText, queryText } from "./atlassian.js";
import { type AtlassianCredentials, writePrivate } from "./credentials.js";

const SEARCH_MAX = 25;
const RECENT_MAX = 30;

export interface Confluence {
	search(text: string): Promise<Outcome<{ pages: ConfluencePageRef[] }>>;
	/** Read a page; once read it heads the recent list. */
	page(id: string): Promise<Outcome<{ page: ConfluencePage }>>;
	recent(): RecentPage[];
}

export function openConfluence(
	credentials: () => AtlassianCredentials | undefined,
	recentFile: string,
	fetchImpl?: Fetch,
	now: () => number = Date.now,
): Confluence {
	const request = (path: string) => atlassianRequest(credentials(), path, { fetch: fetchImpl });
	const wiki = () => `${credentials()?.site ?? ""}/wiki`;
	const spaceNames = new Map<string, string>();

	const recent = (): RecentPage[] => {
		if (!existsSync(recentFile)) return [];
		try {
			const value = JSON.parse(readFileSync(recentFile, "utf8")) as unknown;
			return Array.isArray(value) ? (value as RecentPage[]) : [];
		} catch {
			return [];
		}
	};

	return {
		async search(text) {
			const words = queryText(text);
			if (!words) return { ok: true, pages: [] };
			const cql = `siteSearch ~ "${words}" and type in (page, blogpost) order by lastmodified desc`;
			const answer = await request(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${SEARCH_MAX}`);
			if (!answer.ok) return answer;
			const body = (answer.json ?? {}) as { results?: unknown[]; _links?: { base?: string } };
			const base = body._links?.base ?? wiki();
			const pages = (body.results ?? []).flatMap((raw): ConfluencePageRef[] => {
				const result = raw as {
					content?: { id?: string; title?: string; _links?: { webui?: string } };
					title?: string;
					excerpt?: string;
					url?: string;
					lastModified?: string;
					resultGlobalContainer?: { title?: string };
				};
				const id = result.content?.id;
				if (!id) return [];
				return [
					{
						id: String(id),
						title: htmlText(result.content?.title ?? result.title ?? ""),
						space: result.resultGlobalContainer?.title ?? null,
						url: `${base}${result.content?._links?.webui ?? result.url ?? ""}`,
						excerpt: htmlText((result.excerpt ?? "").replace(/@@@(end)?hl@@@/g, "")),
						lastModified: result.lastModified ?? null,
					},
				];
			});
			return { ok: true, pages };
		},
		async page(given) {
			const id = String(given ?? "").trim();
			if (!/^\d+$/.test(id)) return { ok: false, reason: "That is not a Confluence page id." };
			const answer = await request(`/wiki/api/v2/pages/${id}?body-format=view`);
			if (!answer.ok) return answer;
			const raw = (answer.json ?? {}) as {
				id?: string;
				title?: string;
				spaceId?: string;
				body?: { view?: { value?: string } };
				_links?: { webui?: string; base?: string };
			};
			let space: string | null = null;
			if (raw.spaceId) {
				if (!spaceNames.has(raw.spaceId)) {
					const found = await request(`/wiki/api/v2/spaces/${encodeURIComponent(raw.spaceId)}`);
					const spaceName = found.ok ? (found.json as { name?: unknown } | null)?.name : undefined;
					if (typeof spaceName === "string") spaceNames.set(raw.spaceId, spaceName);
				}
				space = spaceNames.get(raw.spaceId) ?? null;
			}
			const ref: ConfluencePageRef = {
				id,
				title: raw.title ?? "",
				space,
				url: `${raw._links?.base ?? wiki()}${raw._links?.webui ?? `/pages/viewpage.action?pageId=${id}`}`,
			};
			writePrivate(
				recentFile,
				`${JSON.stringify([{ ...ref, openedAt: now() }, ...recent().filter((page) => page.id !== id)].slice(0, RECENT_MAX))}\n`,
			);
			return { ok: true, page: { page: ref, html: raw.body?.view?.value ?? "" } };
		},
		recent,
	};
}

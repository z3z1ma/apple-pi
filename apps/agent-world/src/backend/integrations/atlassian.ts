// Atlassian Cloud's REST APIs (Jira v3 and Confluence) with the operator's email and API token as HTTP basic auth.
// Every request names the site's origin from the stored sign-in; tests point it at a loopback fake server.
import type { Refusal } from "../../integrations.js";
import type { AtlassianCredentials } from "./credentials.js";

export type Fetch = typeof fetch;

const TIMEOUT_MS = 20_000;

/**
 * The site's origin from what the operator typed: `acme`, `acme.atlassian.net`, or a full address. Plain http is
 * allowed only on loopback (the tests' fake servers); undefined when it is no usable address.
 */
export function atlassianSite(site: string): string | undefined {
	let text = site.trim().replace(/\/+$/, "");
	if (!text) return undefined;
	if (!/^[a-z]+:\/\//i.test(text)) text = text.includes(".") ? `https://${text}` : `https://${text}.atlassian.net`;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return undefined;
	}
	const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
	if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return undefined;
	return url.origin;
}

export const NOT_SIGNED_IN: Refusal = {
	ok: false,
	reason: "Sign in to Atlassian in Settings first.",
	signIn: "atlassian",
};

export type AtlassianResponse = { ok: true; status: number; json: unknown } | Refusal;

/** Call `path` on the site; non-2xx answers become a refusal that says what went wrong in plain words. */
export async function atlassianRequest(
	credentials: AtlassianCredentials | undefined,
	path: string,
	options: { method?: string; body?: unknown; fetch?: Fetch } = {},
): Promise<AtlassianResponse> {
	if (!credentials) return NOT_SIGNED_IN;
	const auth = Buffer.from(`${credentials.email}:${credentials.token}`).toString("base64");
	let response: Response;
	try {
		response = await (options.fetch ?? fetch)(`${credentials.site}${path}`, {
			method: options.method ?? "GET",
			headers: {
				Authorization: `Basic ${auth}`,
				Accept: "application/json",
				...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch {
		return { ok: false, reason: `Could not reach ${new URL(credentials.site).host}.` };
	}
	const text = await response.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	if (response.ok) return { ok: true, status: response.status, json };
	if (response.status === 401)
		return {
			ok: false,
			reason: "Atlassian did not accept the email and API token; sign in again in Settings.",
			signIn: "atlassian",
		};
	return { ok: false, reason: atlassianError(response.status, json) };
}

/** Jira and Confluence error bodies (`errorMessages`, `errors`, `message`) as one sentence. */
function atlassianError(status: number, json: unknown): string {
	const body = (json ?? {}) as { errorMessages?: unknown; errors?: unknown; message?: unknown };
	const messages = [
		...(Array.isArray(body.errorMessages) ? body.errorMessages : []),
		...(body.errors && typeof body.errors === "object" ? Object.values(body.errors) : []),
		...(typeof body.message === "string" ? [body.message] : []),
	].filter((message): message is string => typeof message === "string" && message.length > 0);
	if (messages.length) return messages.join(" ");
	if (status === 403) return "Atlassian says you may not do that.";
	if (status === 404) return "Atlassian found nothing there.";
	return `Atlassian answered ${status}.`;
}

/** Quote text for a JQL or CQL string: Lucene's operators become spaces, quotes and backslashes are escaped. */
export function queryText(text: string): string {
	return text
		.replace(/[+\-&|!(){}[\]^~*?:/]/g, " ")
		.replace(/[\\"]/g, "\\$&")
		.replace(/\s+/g, " ")
		.trim();
}

/** Plain text from HTML: tags dropped, common entities decoded, whitespace folded. */
export function htmlText(html: string): string {
	return html
		.replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n\s*/g, "\n\n")
		.trim();
}

// Capturing the operator's Slack web session (the credential decision in ticket 27): he signs in, in an Electron window
// at https://app.slack.com/; once the web client has loaded, its session token (`xoxc-`) is in the page's
// `localStorage.localConfig_v2` (keyed by team id, the current one in the `/client/<team>` path) and its `d` cookie in
// the window's cookie store, which sees HttpOnly cookies. Typed structurally so this file needs no Electron import;
// `src/electron/main.ts` passes a real `BrowserWindow`. Checked by hand, not by tests.

export interface SignInWindow {
	readonly webContents: {
		executeJavaScript(code: string): Promise<unknown>;
		readonly session: {
			readonly cookies: { get(filter: { url?: string; name?: string }): Promise<{ name: string; value: string }[]> };
		};
	};
	isDestroyed(): boolean;
	close(): void;
	once(event: "closed", listener: () => void): unknown;
}

export const SLACK_SIGN_IN_URL = "https://app.slack.com/";
const POLL_MS = 1000;
/** The operator has this long to finish signing in (SSO and two-factor included). */
const SIGN_IN_MS = 15 * 60_000;

/** Runs in the Slack page: the current team's token from the web client's local configuration, or null. */
const READ_TOKEN = `(() => {
	try {
		const config = JSON.parse(localStorage.getItem("localConfig_v2") || "null");
		if (!config || !config.teams) return null;
		const match = location.pathname.match(/^\\/client\\/([A-Z0-9]+)/);
		const id = (match && match[1]) || config.lastActiveTeamId || Object.keys(config.teams)[0];
		const team = id && config.teams[id];
		return team && typeof team.token === "string" && team.token.startsWith("xoxc-") ? team.token : null;
	} catch {
		return null;
	}
})()`;

/**
 * Wait until the window holds a signed-in Slack web session, then close it and resolve with the token and `d`
 * cookie; undefined when the operator closed the window first or the time ran out.
 */
export function captureSlackSession(window: SignInWindow): Promise<{ token: string; cookie: string } | undefined> {
	return new Promise((resolve) => {
		let done = false;
		const finish = (session: { token: string; cookie: string } | undefined) => {
			if (done) return;
			done = true;
			clearInterval(timer);
			clearTimeout(limit);
			if (!window.isDestroyed()) window.close();
			resolve(session);
		};
		const look = async () => {
			if (done || window.isDestroyed()) return;
			try {
				const token = await window.webContents.executeJavaScript(READ_TOKEN);
				if (typeof token !== "string") return;
				const [cookie] = await window.webContents.session.cookies.get({ url: SLACK_SIGN_IN_URL, name: "d" });
				if (cookie?.value) finish({ token, cookie: cookie.value });
			} catch {
				// The page is navigating (sign-in redirects); look again on the next tick.
			}
		};
		const timer = setInterval(() => void look(), POLL_MS);
		const limit = setTimeout(() => finish(undefined), SIGN_IN_MS);
		window.once("closed", () => finish(undefined));
	});
}

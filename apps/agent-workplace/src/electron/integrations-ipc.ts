import { BrowserWindow, ipcMain } from "electron";
import type { Commands } from "../backend/commands.js";
import { openIntegrations } from "../backend/integrations/index.js";
import { captureSlackSession, SLACK_SIGN_IN_URL } from "../backend/integrations/slack-sign-in.js";
import type { WorldSnapshot } from "../world.js";

export function wireIntegrations(options: {
	stateDir: string;
	snapshot: () => WorldSnapshot;
	commands: Commands;
	toWindow: (channel: string, message: unknown) => void;
}) {
	const integrations = openIntegrations(options);
	const handle = (channel: string, listener: (...args: unknown[]) => unknown) =>
		ipcMain.handle(`places:${channel}`, (_event, ...args) => listener(...args));

	handle("credential-status", () => integrations.credentialStatus());
	handle("github-status", () => integrations.githubStatus());
	handle("google-status", () => integrations.googleStatus());
	handle("github-assigned", () => integrations.githubAssigned());
	handle("github-search", (text) => integrations.githubSearch(text));
	handle("github-issue", (key) => integrations.githubIssue(key));
	handle("sign-in-atlassian", (site, email, token) => integrations.signInAtlassian(site, email, token));
	handle("sign-out-atlassian", () => integrations.signOutAtlassian());
	let signingIn: Promise<unknown> | undefined;
	handle("sign-in-slack", () => {
		signingIn ??= (async () => {
			const window = new BrowserWindow({
				width: 1000,
				height: 760,
				title: "Sign in to Slack",
				backgroundColor: "#ffffff",
				webPreferences: {
					partition: "persist:agent-world-slack",
					contextIsolation: true,
					sandbox: true,
					nodeIntegration: false,
				},
			});
			window.webContents.setUserAgent(window.webContents.getUserAgent().replace(/ (Electron|Agent ?World)\/\S+/gi, ""));
			void window.loadURL(SLACK_SIGN_IN_URL);
			const session = await captureSlackSession(window);
			if (!session) return { ok: false, reason: "Slack's sign-in window closed before you signed in." };
			return integrations.storeSlackSession(session);
		})().finally(() => {
			signingIn = undefined;
		});
		return signingIn;
	});
	handle("sign-out-slack", () => integrations.signOutSlack());
	handle("set-slack-send-as-me", (on) => integrations.setSlackSendAsMe(on));

	handle("pull-requests", () => integrations.pullRequests());
	handle("pull-request", (repo, number) => integrations.pullRequest(repo, number));
	handle("jira-assigned", () => integrations.jiraAssigned());
	handle("jira-search", (text) => integrations.jiraSearch(text));
	handle("jira-issue", (key) => integrations.jiraIssue(key));
	handle("jira-transitions", (key) => integrations.jiraTransitions(key));
	handle("confluence-search", (text) => integrations.confluenceSearch(text));
	handle("confluence-page", (id) => integrations.confluencePage(id));
	handle("library-recent", () => integrations.libraryRecent());
	handle("slack-unread", () => integrations.slackUnread());
	handle("slack-search", (text, page) => integrations.slackSearch(text, page));
	handle("slack-conversations", () => integrations.slackConversations());
	handle("slack-channel", (id, at) => integrations.slackChannel(id, at));
	handle("slack-thread", (id, ts) => integrations.slackThread(id, ts));
	handle("slack-mark-read", (id, ts, threadTs) => integrations.slackMarkRead(id, ts, threadTs));
	handle("describe-write", (intent) => integrations.describeWrite(intent));
	handle("confirm-write", (intent, token) => integrations.confirmWrite(intent, token));
	handle("outside-writes", () => integrations.outsideWrites());
	integrations.onOutsideWrite((entry) => options.toWindow("places:outside-write", entry));
	handle("delegate", (commandId, delegation) =>
		integrations.delegate(commandId, delegation, (receipt) => options.toWindow("world:receipt", receipt)),
	);
	return integrations;
}

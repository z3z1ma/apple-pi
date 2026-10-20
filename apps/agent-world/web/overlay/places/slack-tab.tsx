// Slack in the interface (ticket 27): the side panel's Slack tab (the channels with unread messages, one click from
// reading, or every channel filtered by name; the crier to search Slack), the unread orb's number, and Settings' Slack
// sign-in. All read `slack-state`.
import { useState, useSyncExternalStore } from "react";
import { useTheme } from "../../theme-store.js";
import { slack, unreadTotal } from "./slack-state.js";
import { AllChannels, ChannelRow, SlackSignIn } from "./square.js";
import { squarePanels } from "./square-panels.js";

const useSlack = () => useSyncExternalStore(slack.subscribe, slack.get);

/** The Slack tab's icon: two speech bubbles, one answering the other. */
export function SlackIcon() {
	const stroke = {
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.7,
		strokeLinecap: "round",
		strokeLinejoin: "round",
	} as const;
	return (
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<path d="M3.5 6.2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8.4l-3 2.6v-2.6h0a2 2 0 0 1-1.9-2z" {...stroke} />
			<path d="M15.5 9h3a2 2 0 0 1 2 2v4.6a2 2 0 0 1-2 2h-.4v2.4l-2.8-2.4h-3.6a2 2 0 0 1-2-1.6" {...stroke} />
		</svg>
	);
}

/** What the unread orb shows: the unread total (`120+` when there are more than counted), or nothing signed out. */
export function useUnreadOrb(): { text: string; label: string; title: string; signedIn: boolean } {
	const state = useSlack();
	if (state.status !== "signed-in")
		return {
			text: "",
			label: "Slack: not signed in",
			title: state.status === "unavailable" ? "Slack is not available here" : "Slack: sign in under Settings",
			signedIn: false,
		};
	const { count, more } = unreadTotal(state.channels);
	const text = state.listed ? (count > 999 ? "999+" : `${count}${more ? "+" : ""}`) : "\u2026";
	const channels = state.channels.length;
	return {
		text,
		label: `Unread in Slack: ${text}`,
		title: state.listed
			? channels
				? `${text} unread in ${channels} ${channels === 1 ? "channel" : "channels"}`
				: "Nothing unread in Slack"
			: "Reading Slack\u2026",
		signedIn: true,
	};
}

/** The Slack tab: every channel with unread messages, most pressing first, or every channel; the crier to search. */
export function SlackTab() {
	const state = useSlack();
	const theme = useTheme();
	const [view, setView] = useState<"unread" | "all">("unread");
	const crier = theme?.labels.crier ?? "the crier";
	if (state.status === "unavailable") return <p className="aw-empty">Slack is not available in this window.</p>;
	if (state.status !== "signed-in")
		return (
			<section aria-label="Slack" className="aw-slack-tab">
				<SlackSignIn
					state={state}
					lead={
						<p className="aw-note">Sign in to Slack as yourself to see its unread channels here and in the square.</p>
					}
				/>
			</section>
		);
	const { channels } = state;
	return (
		<section aria-label="Slack" className="aw-slack-tab">
			{/* The Mail tab's head, with its action beside the title. */}
			<h3 className="aw-mail-head">
				<span>{state.account?.team ?? "Slack"}</span>
				<button type="button" className="aw-button aw-mail-write" onClick={() => squarePanels.openCrier()}>
					Ask the {crier.toLowerCase()}
				</button>
			</h3>
			<div className="aw-slack-views aw-slack-tab-views">
				<button type="button" className="aw-button" aria-pressed={view === "unread"} onClick={() => setView("unread")}>
					Unread
				</button>
				<button type="button" className="aw-button" aria-pressed={view === "all"} onClick={() => setView("all")}>
					All channels
				</button>
			</div>
			{view === "all" ? (
				<AllChannels theme={theme} inTab />
			) : (
				<>
					{state.problem && <p className="aw-note aw-slack-problem">{state.problem}</p>}
					{channels.length ? (
						<ul className="aw-slack-list" aria-label="Unread channels">
							{channels.map((channel) => (
								<ChannelRow key={channel.id} channel={channel} theme={theme} />
							))}
						</ul>
					) : (
						<p className="aw-empty">{state.listed ? "Nothing unread." : "Reading Slack\u2026"}</p>
					)}
				</>
			)}
		</section>
	);
}

/** Settings: sign in to Slack (its own window, captured by the backend), see the workspace, and sign out. */
export function SlackSettings() {
	const state = useSlack();
	if (state.status === "unavailable") return null;
	const account = state.account;
	return (
		<section aria-label="Slack" className="aw-slack-settings">
			<h3>
				<span>Slack</span>
			</h3>
			{state.status === "signed-in" && account ? (
				<div className="aw-slack-account">
					<p className="aw-note">
						Signed in to <strong>{account.team ?? "your workspace"}</strong>
						{account.user ? ` as ${account.user}` : ""}
						{account.url ? (
							<small className="aw-slack-url">{account.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</small>
						) : null}
					</p>
					<button type="button" className="aw-button" onClick={() => void slack.signOut()}>
						Sign out of Slack
					</button>
					{state.signInProblem && (
						<p className="aw-progress aw-progress-failed" role="status">
							{state.signInProblem}
						</p>
					)}
				</div>
			) : (
				<SlackSignIn state={state} settings />
			)}
		</section>
	);
}

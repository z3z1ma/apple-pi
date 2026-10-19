// Settings' Atlassian section (ticket 24): the site, email, and API token that let the quest office and the library read
// and write Jira and Confluence as the operator. The token goes to the backend once, which checks it against the site
// and keeps it in its private file; from then on Settings knows only that it is set, never the token itself.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { atlassian } from "./atlassian-state.js";
import type { Progress } from "./place-panels.js";

const TOKENS_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";
/** The last request to sign in that Settings answered (it may mount only once asked). */
let answeredAsk = 0;

const host = (site: string) => site.replace(/^https?:\/\//, "").replace(/\/$/, "");

export function AtlassianSettings() {
	const state = useSyncExternalStore(atlassian.subscribe, atlassian.get);
	const signedIn = state.signedIn;
	const [editing, setEditing] = useState(false);
	const [progress, setProgress] = useState<Progress>();
	const section = useRef<HTMLElement>(null);

	// Asked for from a place (which opened Settings): show the form, bring it into view, and put the cursor in it.
	useEffect(() => {
		if (state.signInAsked === answeredAsk) return;
		answeredAsk = state.signInAsked;
		setEditing(true);
		requestAnimationFrame(() => {
			section.current?.scrollIntoView({ block: "nearest" });
			section.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
		});
	}, [state.signInAsked]);

	useEffect(() => {
		if (state.signedIn === undefined) void atlassian.refreshStatus();
	}, [state.signedIn]);

	if (!state.api?.signInAtlassian) return null;
	const showForm = !signedIn || editing;
	return (
		<section ref={section} aria-label="Atlassian" className="aw-atlassian-settings">
			<h3>
				<span>Atlassian</span>
				<small>Jira and Confluence</small>
			</h3>
			{signedIn && !editing && (
				<div className="aw-account">
					<dl className="aw-account-facts">
						<dt>Site</dt>
						<dd>{host(signedIn.site)}</dd>
						<dt>Email</dt>
						<dd>{signedIn.email}</dd>
						<dt>API token</dt>
						<dd>
							<span className="aw-account-set">Set</span>
						</dd>
					</dl>
					<p className="aw-note aw-account-note">Kept in Agent World&rsquo;s private file; never shown again.</p>
					<div className="aw-account-actions">
						<button
							type="button"
							className="aw-button"
							onClick={() => {
								setProgress(undefined);
								setEditing(true);
							}}
						>
							Change
						</button>
						<button
							type="button"
							className="aw-button"
							onClick={async () => {
								const result = await atlassian.signOut();
								setProgress(
									result.ok
										? { state: "done", text: "Signed out; the token is deleted." }
										: { state: "failed", text: result.reason },
								);
							}}
						>
							Sign out
						</button>
					</div>
				</div>
			)}
			{showForm && (
				<SignInForm
					site={signedIn?.site}
					email={signedIn?.email}
					onCancel={signedIn ? () => setEditing(false) : undefined}
					onDone={(text) => {
						setEditing(false);
						setProgress({ state: "done", text });
					}}
				/>
			)}
			{progress && !showForm && (
				<p className={`aw-progress aw-progress-${progress.state}`} role="status">
					{progress.text}
				</p>
			)}
		</section>
	);
}

function SignInForm({
	site: knownSite,
	email: knownEmail,
	onCancel,
	onDone,
}: {
	site?: string;
	email?: string;
	onCancel?: () => void;
	onDone: (text: string) => void;
}) {
	const [site, setSite] = useState(knownSite ? host(knownSite) : "");
	const [email, setEmail] = useState(knownEmail ?? "");
	const [token, setToken] = useState("");
	const [progress, setProgress] = useState<Progress>();
	const sending = progress?.state === "sending";
	const ready = site.trim() && email.trim() && token.trim() && !sending;

	const submit = async () => {
		if (!ready) return;
		setProgress({ state: "sending", text: `Checking with ${host(site.trim())}\u2026` });
		const result = await atlassian.signIn(site.trim(), email.trim(), token.trim());
		// The token leaves the page either way: it is never kept here.
		setToken("");
		if (result.ok) onDone(result.name ? `Signed in as ${result.name}.` : "Signed in.");
		else setProgress({ state: "failed", text: result.reason });
	};

	return (
		<form
			className="aw-signin"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<p className="aw-note">
				The quest office and the library read Jira and Confluence as you. Your API token goes to Agent World&rsquo;s
				private file and is never shown again.
			</p>
			<label className="aw-field">
				<span>Site</span>
				<input
					type="text"
					inputMode="url"
					autoComplete="url"
					spellCheck={false}
					placeholder="your-team.atlassian.net"
					value={site}
					onChange={(event) => setSite(event.target.value)}
				/>
			</label>
			<label className="aw-field">
				<span>Email</span>
				<input
					type="email"
					autoComplete="username"
					spellCheck={false}
					placeholder="you@example.com"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
				/>
			</label>
			<label className="aw-field">
				<span>API token</span>
				<input
					type="password"
					autoComplete="off"
					spellCheck={false}
					placeholder={knownSite ? "A new token" : "Paste your token"}
					value={token}
					onChange={(event) => setToken(event.target.value)}
				/>
			</label>
			<button
				type="button"
				className="aw-link-button"
				onClick={() => void atlassian.openLink(TOKENS_URL)}
				title={TOKENS_URL}
			>
				Create an API token at id.atlassian.com
			</button>
			<div className="aw-account-actions">
				{onCancel && (
					<button type="button" className="aw-button" onClick={onCancel}>
						Cancel
					</button>
				)}
				<button type="submit" className="aw-button aw-button-strong" disabled={!ready}>
					{sending ? "Checking\u2026" : "Sign in"}
				</button>
			</div>
			{progress && (
				<p className={`aw-progress aw-progress-${progress.state}`} role="status">
					{progress.text}
				</p>
			)}
		</form>
	);
}

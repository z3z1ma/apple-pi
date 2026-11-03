import { useEffect, useState } from "react";
import type { CliStatus, CredentialStatus, Outcome } from "../src/integrations.js";
import { Select } from "./workplace-fields.js";
import { CONNECTIONS_CHANGED, type IssuesSource, useIssuesSource } from "./workplace-issues-source.js";
import "./workplace-connections.css";

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AtlassianSignIn({ onDone }: { onDone: () => void }) {
	const [site, setSite] = useState("");
	const [email, setEmail] = useState("");
	const [token, setToken] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	return (
		<form
			className="wp-connections-signin"
			aria-label="Connect Jira"
			onSubmit={async (event) => {
				event.preventDefault();
				if (busy) return;
				setBusy(true);
				setError("");
				try {
					const result = await window.agentWorkplace.signInAtlassian(site.trim(), email.trim(), token.trim());
					if (result.ok) onDone();
					else setError(result.reason);
				} catch (error) {
					setError(failure(error));
				} finally {
					setToken("");
					setBusy(false);
				}
			}}
		>
			<h3>Connect Jira</h3>
			<p>
				Jira and Confluence use your Atlassian account. The backend checks your token and keeps it in its private file;
				this page never reads it back.
			</p>
			<label className="wp-field">
				Atlassian site
				<input
					required
					value={site}
					onChange={(event) => setSite(event.target.value)}
					placeholder="your-team.atlassian.net"
					autoComplete="url"
				/>
			</label>
			<label className="wp-field">
				Email
				<input
					required
					type="email"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					autoComplete="username"
				/>
			</label>
			<label className="wp-field">
				API token
				<input
					required
					type="password"
					value={token}
					onChange={(event) => setToken(event.target.value)}
					autoComplete="off"
				/>
			</label>
			<button
				type="submit"
				className="wp-button wp-button-primary"
				disabled={busy || !site.trim() || !email.trim() || !token.trim()}
			>
				{busy ? "Checking account..." : "Connect Jira"}
			</button>
			{error && <p role="alert">{error}</p>}
		</form>
	);
}

function CliAccount({ status, command }: { status: CliStatus | undefined; command: string }) {
	return (
		<>
			{!status ? (
				<p role="status">Checking sign-in...</p>
			) : status.ok && status.account ? (
				<p>
					Signed in as <strong>{status.account}</strong>
				</p>
			) : (
				<>
					<p>{status.ok ? "Not signed in." : status.reason}</p>
					<p>
						In a terminal, run <code>{command}</code>, then refresh connections.
					</p>
				</>
			)}
		</>
	);
}

export function Connections() {
	const [credentials, setCredentials] = useState<CredentialStatus>();
	const [github, setGithub] = useState<CliStatus>();
	const [google, setGoogle] = useState<CliStatus>();
	const [refresh, setRefresh] = useState(0);
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const issues = useIssuesSource();
	// biome-ignore lint/correctness/useExhaustiveDependencies: explicit Refresh rechecks the CLI identities and stored accounts
	useEffect(() => {
		let current = true;
		setGithub(undefined);
		setGoogle(undefined);
		void window.agentWorkplace
			.credentialStatus()
			.then((status) => {
				if (current) setCredentials(status);
			})
			.catch((error) => {
				if (current) setError(failure(error));
			});
		void window.agentWorkplace
			.githubStatus()
			.then((status) => {
				if (current) setGithub(status);
			})
			.catch((error) => {
				if (current) setGithub({ ok: false, reason: failure(error) });
			});
		void window.agentWorkplace
			.googleStatus()
			.then((status) => {
				if (current) setGoogle(status);
			})
			.catch((error) => {
				if (current) setGoogle({ ok: false, reason: failure(error) });
			});
		return () => {
			current = false;
		};
	}, [refresh]);
	const changed = () => {
		setRefresh((value) => value + 1);
		window.dispatchEvent(new Event(CONNECTIONS_CHANGED));
	};
	const act = async (name: string, action: () => Promise<Outcome<object>>) => {
		if (busy) return;
		setBusy(name);
		setError("");
		try {
			const result = await action();
			if (result.ok) changed();
			else setError(result.reason);
		} catch (error) {
			setError(failure(error));
		} finally {
			setBusy("");
		}
	};
	return (
		<div className="wp-connections">
			<header>
				<h2>Connections</h2>
				<button
					type="button"
					className="wp-button"
					disabled={!!busy}
					onClick={() => {
						setError("");
						setRefresh((value) => value + 1);
					}}
				>
					Refresh connections
				</button>
			</header>
			{error && <p role="alert">{error}</p>}
			<section aria-label="Issues source">
				<h3>Issues source</h3>
				<p>Show one service at a time in Issues. Your choice stays on this device.</p>
				<Select<IssuesSource>
					label="Issues source"
					value={issues.source ?? "github"}
					disabled={!issues.source}
					options={[
						{ value: "jira", label: "Jira" },
						{ value: "github", label: "GitHub" },
					]}
					onChange={issues.chooseSource}
				/>
				{issues.error && <p role="alert">{issues.error}</p>}
			</section>
			<section aria-label="Atlassian connection">
				<h3>Atlassian</h3>
				{!credentials ? (
					<p role="status">Reading account...</p>
				) : credentials.atlassian ? (
					<>
						<p>
							Signed in as <strong>{credentials.atlassian.email}</strong>
						</p>
						<p>{credentials.atlassian.site}</p>
						<button
							type="button"
							className="wp-button"
							disabled={!!busy}
							onClick={() => void act("atlassian", () => window.agentWorkplace.signOutAtlassian())}
						>
							Sign out of Atlassian
						</button>
					</>
				) : (
					<AtlassianSignIn onDone={changed} />
				)}
			</section>
			<section aria-label="Slack connection">
				<h3>Slack</h3>
				{!credentials ? (
					<p role="status">Reading account...</p>
				) : (
					<>
						<p>
							{credentials.slack
								? `Signed in to ${credentials.slack.team ?? credentials.slack.url ?? "Slack"}${credentials.slack.user ? ` as ${credentials.slack.user}` : ""}`
								: "Not signed in."}
						</p>
						<button
							type="button"
							className="wp-button"
							disabled={!!busy}
							onClick={() =>
								void act("slack", () =>
									credentials.slack ? window.agentWorkplace.signOutSlack() : window.agentWorkplace.signInSlack(),
								)
							}
						>
							{busy === "slack" ? "Waiting for Slack..." : credentials.slack ? "Sign out of Slack" : "Sign in to Slack"}
						</button>
					</>
				)}
			</section>
			<section aria-label="GitHub connection">
				<h3>GitHub</h3>
				<CliAccount status={github} command="gh auth login" />
			</section>
			<section aria-label="Google connection">
				<h3>Google</h3>
				<p>Used by the runtime's calendar and email sources.</p>
				<CliAccount status={google} command="gws auth login" />
			</section>
		</div>
	);
}

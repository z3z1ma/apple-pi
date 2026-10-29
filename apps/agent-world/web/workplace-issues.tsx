import { useEffect, useRef, useState } from "react";
import type { JiraIssue, JiraIssueDetail, JiraTransition } from "../src/integrations.js";
import type { WorldSnapshot } from "../src/world.js";
import { useOutsideWrite, type WriteState } from "./overlay/places/outside-write.js";
import { RichView } from "./overlay/places/rich-view.js";
import "./workplace-issues.css";

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

function JiraSignIn({ onDone }: { onDone: () => void }) {
	const [site, setSite] = useState("");
	const [email, setEmail] = useState("");
	const [token, setToken] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	return (
		<form
			className="wp-issues-signin"
			aria-label="Connect Jira"
			onSubmit={async (event) => {
				event.preventDefault();
				if (busy) return;
				setBusy(true);
				setError("");
				try {
					const result = await window.agentWorld.signInAtlassian(site.trim(), email.trim(), token.trim());
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
			<h2>Connect Jira</h2>
			<p>Use your existing Atlassian account. Your token is checked and kept by Agent World, not this page.</p>
			<label>
				Atlassian site
				<input
					required
					value={site}
					onChange={(event) => setSite(event.target.value)}
					placeholder="your-team.atlassian.net"
					autoComplete="url"
				/>
			</label>
			<label>
				Email
				<input
					required
					type="email"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					autoComplete="username"
				/>
			</label>
			<label>
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
				className="wp-issues-primary"
				disabled={busy || !site.trim() || !email.trim() || !token.trim()}
			>
				{busy ? "Checking account..." : "Connect Jira"}
			</button>
			{error && <p role="alert">{error}</p>}
		</form>
	);
}

function DelegateIssue({
	issue,
	world,
	openDM,
}: {
	issue: JiraIssue;
	world: WorldSnapshot;
	openDM: (id: string) => void;
}) {
	const [to, setTo] = useState("");
	const [note, setNote] = useState("");
	const [progress, setProgress] = useState<{ phase: string; text: string; to: string }>();
	const current = useRef<{ id: string; phase: string } | undefined>(undefined);
	const names = useRef(world.characters);
	names.current = world.characters;
	useEffect(() => {
		const stop = window.agentWorld.onReceipt((receipt) => {
			if (receipt.commandId !== current.current?.id) return;
			current.current.phase = receipt.stage;
			const person = names.current.find((person) => person.id === receipt.characterId)?.name ?? receipt.characterId;
			const text =
				receipt.stage === "failed"
					? (receipt.reason ?? "The instruction did not reach them.")
					: receipt.stage === "applied"
						? `${person} received the instruction. Work completion is not yet known.`
						: receipt.stage === "delivered"
							? `Delivered to ${person}; waiting for application.`
							: `Accepted for ${person}; waiting for delivery.`;
			setProgress({ phase: receipt.stage, text, to: receipt.characterId });
		});
		return () => {
			current.current = undefined;
			stop();
		};
	}, []);
	const heads = new Set(world.headquarters.map((team) => team.id));
	for (const person of world.characters) if (person.facts?.reportsTo) heads.add(person.facts.reportsTo);
	const people = world.characters;
	const locked = progress !== undefined && progress.phase !== "failed";
	return (
		<form
			className="wp-issues-delegate"
			aria-label="Delegate issue"
			onSubmit={async (event) => {
				event.preventDefault();
				if (locked || !note.trim() || !people.some((person) => person.id === to)) return;
				const id = crypto.randomUUID();
				current.current = { id, phase: "sending" };
				setProgress({ phase: "sending", text: "Sending instruction...", to });
				try {
					const result = await window.agentWorld.delegate(id, {
						to,
						item: { kind: "issue", key: issue.key, summary: issue.summary, url: issue.url },
						ask: "start-work",
						note: note.trim(),
					});
					if (current.current?.id !== id) return;
					if (!result.ok) {
						current.current.phase = "failed";
						setProgress({ phase: "failed", text: result.reason, to });
					} else if (current.current.phase === "sending") {
						current.current.phase = "accepted";
						setProgress({
							phase: "accepted",
							text:
								result.command === "follow_up"
									? "Queued after their current turn. Waiting for delivery."
									: "Instruction accepted. Waiting for delivery.",
							to: result.to,
						});
					}
				} catch (error) {
					if (current.current?.id === id) {
						current.current.phase = "failed";
						setProgress({ phase: "failed", text: failure(error), to });
					}
				}
			}}
		>
			<h3>Delegate to your team</h3>
			<p>This sends an instruction, not a Jira assignment.</p>
			<label>
				Person or team head
				<select
					aria-label="Person or team head"
					value={to}
					disabled={locked || !world.connected}
					onChange={(event) => setTo(event.target.value)}
				>
					<option value="">Choose a recipient</option>
					{people.map((person) => (
						<option key={person.id} value={person.id}>
							{person.name}
							{heads.has(person.id) ? " (team head)" : ""}
						</option>
					))}
				</select>
			</label>
			<label>
				Goal and context
				<textarea
					maxLength={4000}
					rows={3}
					value={note}
					disabled={locked}
					onChange={(event) => setNote(event.target.value)}
					placeholder="What should they do, and how will you know it is done?"
				/>
			</label>
			<button
				type="submit"
				className="wp-issues-primary"
				disabled={locked || !world.connected || !note.trim() || !people.some((person) => person.id === to)}
			>
				Send instruction
			</button>
			{!world.connected && <p role="status">The agent runtime is disconnected.</p>}
			{!people.length && <p>No awake people are available. Start a person in Org first.</p>}
			{progress && (
				<div role={progress.phase === "failed" ? "alert" : "status"}>
					<p>{progress.text}</p>
					{progress.phase !== "failed" && progress.phase !== "sending" && (
						<button type="button" onClick={() => openDM(progress.to)}>
							Open conversation
						</button>
					)}
				</div>
			)}
		</form>
	);
}

function WriteConfirmation({
	state,
	confirm,
	cancel,
}: {
	state: Extract<WriteState, { phase: "confirming" | "sending" }>;
	confirm: () => void;
	cancel: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const decline = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const element = dialog.current!;
		const before = document.activeElement;
		element.showModal();
		decline.current?.focus();
		return () => {
			element.close();
			if (before instanceof HTMLElement && before.isConnected) before.focus();
		};
	}, []);
	const sending = state.phase === "sending";
	return (
		<dialog
			ref={dialog}
			className="wp-issues-confirm"
			aria-label="Confirm Jira change"
			onCancel={(event) => {
				event.preventDefault();
				if (!sending) cancel();
			}}
		>
			<h2>{state.description.what}</h2>
			<p>{state.description.where}</p>
			<p>As you, under your own account.</p>
			<blockquote>{state.description.text}</blockquote>
			<div>
				<button type="button" ref={decline} disabled={sending} onClick={cancel}>
					Don't send
				</button>
				<button type="button" className="wp-issues-primary" disabled={sending} onClick={confirm}>
					{sending ? "Sending..." : "Send as you"}
				</button>
			</div>
		</dialog>
	);
}

function IssueTransitions({ issue, active, onChanged }: { issue: JiraIssue; active: boolean; onChanged: () => void }) {
	const [transitions, setTransitions] = useState<JiraTransition[]>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const write = useOutsideWrite(window.agentWorld);
	const cancel = write.cancel;
	useEffect(() => {
		if (!active) cancel();
	}, [active, cancel]);
	const changed = useRef(onChanged);
	changed.current = onChanged;
	useEffect(() => {
		if (write.state.phase === "sent" && write.state.entry.ok) {
			setTransitions(undefined);
			changed.current();
		}
	}, [write.state]);
	const pending = ["describing", "confirming", "sending"].includes(write.state.phase);
	return (
		<div className="wp-issues-transitions">
			<button
				type="button"
				disabled={loading || pending}
				onClick={async () => {
					setLoading(true);
					setError("");
					try {
						const result = await window.agentWorld.jiraTransitions(issue.key);
						if (result.ok) setTransitions(result.transitions);
						else setError(result.reason);
					} catch (error) {
						setError(failure(error));
					} finally {
						setLoading(false);
					}
				}}
			>
				{loading ? "Loading statuses..." : "Change status"}
			</button>
			{transitions && (
				<section className="wp-issues-transition-options" aria-label="Available Jira transitions">
					{transitions.length ? (
						transitions.map((transition) => (
							<button
								key={transition.id}
								type="button"
								disabled={pending}
								onClick={() => void write.ask({ kind: "jira-transition", key: issue.key, transition: transition.id })}
							>
								{transition.name}
								{transition.to && transition.to !== transition.name ? ` → ${transition.to}` : ""}
							</button>
						))
					) : (
						<p>No status changes are available.</p>
					)}
				</section>
			)}
			{error && <p role="alert">{error}</p>}
			{write.state.phase === "describing" && <p role="status">Preparing your confirmation...</p>}
			{write.state.phase === "failed" && <p role="alert">{write.state.reason}</p>}
			{write.state.phase === "sent" && (
				<p role={write.state.entry.ok ? "status" : "alert"}>
					{write.state.entry.ok
						? "Jira status updated."
						: (write.state.entry.reason ?? "Jira did not accept the change.")}
				</p>
			)}
			{(write.state.phase === "confirming" || write.state.phase === "sending") && (
				<WriteConfirmation state={write.state} confirm={() => void write.confirm()} cancel={write.cancel} />
			)}
		</div>
	);
}

function IssueDetail({
	issueKey,
	world,
	active,
	openDM,
	onClose,
	onChanged,
	outsideResults,
}: {
	issueKey: string;
	world: WorldSnapshot;
	active: boolean;
	openDM: (id: string) => void;
	onClose: () => void;
	onChanged: () => void;
	outsideResults: boolean;
}) {
	const [detail, setDetail] = useState<JiraIssueDetail>();
	const [error, setError] = useState("");
	const [refresh, setRefresh] = useState(0);
	const [loading, setLoading] = useState(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: explicit refresh rereads the selected issue
	useEffect(() => {
		let current = true;
		setLoading(true);
		setError("");
		void window.agentWorld
			.jiraIssue(issueKey)
			.then((result) => {
				if (!current) return;
				if (result.ok) setDetail(result.detail);
				else setError(result.reason);
			})
			.catch((error) => {
				if (current) setError(failure(error));
			})
			.finally(() => {
				if (current) setLoading(false);
			});
		return () => {
			current = false;
		};
	}, [issueKey, refresh]);
	const openLink = (url: string) => {
		void window.agentWorld
			.openLink(url)
			.then((result) => {
				if (!result.ok) setError(result.reason);
			})
			.catch((error) => setError(failure(error)));
	};
	return (
		<section className="wp-issues-detail" aria-label="Issue detail" hidden={!active}>
			<header>
				<span className="wp-issues-detail-key">
					{issueKey}
					{outsideResults && <small>Outside current results</small>}
				</span>
				<div>
					<button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>
						Refresh issue
					</button>
					<button type="button" aria-label="Close issue" onClick={onClose}>
						Close
					</button>
				</div>
			</header>
			{loading && <p role="status">Reading issue...</p>}
			{error && <p role="alert">{error}</p>}
			{detail && (
				<div className="wp-issues-detail-body">
					<div className="wp-issues-eyebrow">
						{detail.issue.project ?? "Jira"} / {detail.issue.type ?? "Issue"}
					</div>
					<h2>
						<span className="wp-issues-title-key">{issueKey} · </span>
						{detail.issue.summary}
					</h2>
					<div className="wp-issues-facts">
						<span className="wp-issues-status" data-category={detail.issue.statusCategory}>
							{detail.issue.status ?? "Unknown status"}
						</span>
						<span>{detail.issue.priority ?? "No priority"}</span>
						<span>{detail.issue.assignee ?? "Unassigned"}</span>
					</div>
					<div className="wp-issues-actions">
						<button type="button" onClick={() => openLink(detail.issue.url)}>
							Open in Jira ↗
						</button>
						<IssueTransitions
							issue={detail.issue}
							active={active}
							onChanged={() => {
								setRefresh((value) => value + 1);
								onChanged();
							}}
						/>
					</div>
					<details className="wp-issues-delegate-disclosure">
						<summary>Delegate</summary>
						<DelegateIssue issue={detail.issue} world={world} openDM={openDM} />
					</details>
					<h3>Description</h3>
					<RichView
						className="wp-issues-prose"
						html={detail.descriptionHtml}
						text={detail.descriptionText}
						base={detail.issue.url}
						empty="No description."
						onLink={openLink}
					/>
					<section className="wp-issues-comments" aria-label="Issue comments">
						<h3>
							Comments <span>{detail.comments.length}</span>
						</h3>
						{detail.comments.length ? (
							detail.comments.map((comment) => (
								<article key={comment.id}>
									<header>
										<strong>{comment.author ?? "Unknown author"}</strong>
										<time>{comment.created ? new Date(comment.created).toLocaleString() : ""}</time>
									</header>
									<RichView
										className="wp-issues-prose"
										html={comment.html}
										text={comment.text}
										base={detail.issue.url}
										onLink={openLink}
									/>
								</article>
							))
						) : (
							<p>No comments yet.</p>
						)}
					</section>
				</div>
			)}
		</section>
	);
}

export function WorkplaceIssues({
	world,
	active,
	openDM,
}: {
	world: WorldSnapshot;
	active: boolean;
	openDM: (id: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [search, setSearch] = useState("");
	const [issues, setIssues] = useState<JiraIssue[]>([]);
	const [selected, setSelected] = useState<string>();
	const [opened, setOpened] = useState<string[]>([]);
	const [refresh, setRefresh] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [signedOut, setSignedOut] = useState(false);
	const [started, setStarted] = useState(active);
	useEffect(() => {
		if (active) setStarted(true);
	}, [active]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: explicit refresh rereads the current Jira query
	useEffect(() => {
		if (!started) return;
		let current = true;
		setLoading(true);
		setError("");
		void (async () => {
			try {
				const status = await window.agentWorld.credentialStatus();
				if (!current) return;
				setSignedOut(!status.atlassian);
				if (!status.atlassian) {
					setIssues([]);
					return;
				}
				const result = search ? await window.agentWorld.jiraSearch(search) : await window.agentWorld.jiraAssigned();
				if (!current) return;
				if (result.ok) setIssues(result.issues);
				else {
					setIssues([]);
					setError(result.reason);
					setSignedOut(result.signIn === "atlassian");
				}
			} catch (error) {
				if (current) setError(failure(error));
			} finally {
				if (current) setLoading(false);
			}
		})();
		return () => {
			current = false;
		};
	}, [started, search, refresh]);
	return (
		<section className="wp-issues" aria-label="Issues" hidden={!active}>
			<header className="wp-issues-header">
				<div>
					<h1>Issues</h1>
					<span className="wp-issues-source">Jira</span>
				</div>
				<button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>
					Refresh issues
				</button>
			</header>
			<div className="wp-issues-toolbar">
				<button
					type="button"
					aria-pressed={!search}
					onClick={() => {
						setQuery("");
						setSearch("");
					}}
				>
					My issues
				</button>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (query.trim()) {
							setSearch(query.trim());
							setRefresh((value) => value + 1);
						}
					}}
				>
					<input
						type="search"
						aria-label="Search issues"
						placeholder="Search issues or paste a Jira key"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<button type="submit" disabled={!query.trim() || loading}>
						Search
					</button>
				</form>
			</div>
			{signedOut && error && (
				<p className="wp-issues-notice" role="alert">
					{error}
				</p>
			)}
			{signedOut && <JiraSignIn onDone={() => setRefresh((value) => value + 1)} />}
			<div className={`wp-issues-layout${selected ? " has-detail" : ""}`} hidden={signedOut}>
				<div className="wp-issues-list">
					<div className="wp-issues-list-heading">
						<h2>{search ? `Results for “${search}”` : "Assigned to you"}</h2>
						<span>
							{issues.length} {issues.length === 1 ? "issue" : "issues"}
						</span>
					</div>
					{loading && (
						<p className="wp-issues-notice" role="status">
							Loading issues...
						</p>
					)}
					{error && (
						<p className="wp-issues-notice" role="alert">
							{error}
						</p>
					)}
					{!loading && !error && !issues.length && (
						<div className="wp-issues-empty">
							<h3>{search ? "No matching issues" : "You're all caught up"}</h3>
							<p>
								{search
									? "Try an issue key or a different search."
									: "No unfinished Jira issues are assigned to you. Search to find other work."}
							</p>
						</div>
					)}
					<div className="wp-issues-rows">
						{issues.map((issue) => (
							<button
								type="button"
								className="wp-issues-row"
								key={issue.key}
								aria-label={`Read issue: ${issue.key} ${issue.summary}`}
								aria-pressed={selected === issue.key}
								onClick={() => {
									setOpened((keys) => (keys.includes(issue.key) ? keys : [...keys, issue.key]));
									setSelected(issue.key);
								}}
							>
								<span className="wp-issues-key">{issue.key}</span>
								<strong>{issue.summary}</strong>
								<span className="wp-issues-row-meta">
									<span className="wp-issues-status" data-category={issue.statusCategory}>
										{issue.status ?? "Unknown"}
									</span>
									<span className="wp-issues-priority">{issue.priority ?? "No priority"}</span>
									<span className="wp-issues-assignee">{issue.assignee ?? "Unassigned"}</span>
								</span>
							</button>
						))}
					</div>
				</div>
				{opened.map((key) => (
					<IssueDetail
						key={key}
						issueKey={key}
						world={world}
						active={active && !signedOut && selected === key}
						outsideResults={!issues.some((issue) => issue.key === key)}
						openDM={openDM}
						onClose={() => setSelected(undefined)}
						onChanged={() => setRefresh((value) => value + 1)}
					/>
				))}
			</div>
		</section>
	);
}

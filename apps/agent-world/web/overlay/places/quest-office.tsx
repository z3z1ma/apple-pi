// The quest office's panels (tickets 24 and 25), in the theme's words: the clerk's board of the Jira issues assigned to
// the operator, with a search across every issue; and one issue read in full (its fields, sanitised description, and
// comments) with Open in Jira, Comment and Move as the operator (each through the outside-write gate's confirmation),
// and Hand to the coordinator (an instruction; nothing is written to Jira).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
	JiraIssue,
	JiraIssueDetail,
	JiraTransition,
	OutsideWriteIntent,
	WriteResult,
} from "../../../src/integrations.js";
import type { WorldSnapshot } from "../../../src/world.js";
import { portraitOf } from "../../looks.js";
import { say, type Theme } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import { ago } from "../interface/model.js";
import { atlassian, type NoticeKind, noticeOf } from "./atlassian-state.js";
import { GatedWrite } from "./gated-write.js";
import { HandOver } from "./hand-over.js";
import { PlaceDialog } from "./place-dialog.js";
import type { Progress } from "./place-panels.js";
import { RichView } from "./rich-view.js";

const failure = (error: unknown) => String((error as Error)?.message ?? error);
const since = (iso: string | null | undefined) => (iso ? ago(Date.parse(iso)) : "");
const when = (iso: string | null | undefined) => {
	const text = since(iso);
	return !text ? "" : text === "now" ? "just now" : `${text} ago`;
};

const NOTICE_WORDS: Record<NoticeKind, string> = {
	open: "Open",
	urgent: "Urgent",
	progress: "In progress",
	done: "Done",
};

/** The notice an issue is pinned as, drawn small: the same sprite the board shows. */
function NoticeIcon({ theme, kind }: { theme: Theme | undefined; kind: NoticeKind }) {
	if (!theme) return <span className="aw-notice-icon" />;
	return (
		<span className={`aw-notice-icon aw-notice-${kind}`} title={NOTICE_WORDS[kind]}>
			<img src={`${theme.url}overlays/notice-${kind}.png`} alt="" draggable={false} />
		</span>
	);
}

/** An issue's status as a small pill, coloured by its category (to do, in progress, done). */
function StatusPill({ issue }: { issue: JiraIssue }) {
	if (!issue.status) return null;
	const category =
		issue.statusCategory === "done" ? "done" : issue.statusCategory === "indeterminate" ? "doing" : "todo";
	return <span className={`aw-jira-status aw-jira-status-${category}`}>{issue.status}</span>;
}

/** The clerk's greeting over the operator's own issues, before sign-in, or while they are read. */
function greeting(theme: Theme | undefined, reading: ReturnType<typeof atlassian.get>["assigned"], signedOut: boolean) {
	if (signedOut || reading.state === "signed-out") return say(theme, "quest-signed-out");
	const items = "items" in reading ? reading.items : undefined;
	if (!items) return reading.state === "failed" ? reading.reason : "Let me look\u2026";
	if (!items.length) return say(theme, "quest-empty");
	return items.length === 1 ? say(theme, "quest-greeting-one") : say(theme, "quest-greeting", { count: items.length });
}

export function QuestOfficePanels({ world }: { world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(atlassian.subscribe, atlassian.get);
	const panel = state.panel;
	const label = useTheme()?.labels["quest-office"] ?? "Quest office";
	if (panel?.kind !== "clerk" && panel?.kind !== "issue") return null;
	return (
		<PlaceDialog
			key={state.opening}
			label={panel.kind === "issue" ? `Issue ${panel.key}` : label}
			className={`aw-quest${panel.kind === "issue" ? " aw-quest-issue" : ""}`}
			onClose={() => atlassian.dismiss()}
		>
			{panel.kind === "clerk" ? (
				<ClerkBoard onOpen={(key) => atlassian.show({ kind: "issue", key, from: "clerk" })} />
			) : (
				<IssueView
					key={panel.key}
					issueKey={panel.key}
					world={world}
					onBack={panel.from === "clerk" ? () => atlassian.show({ kind: "clerk" }) : undefined}
				/>
			)}
		</PlaceDialog>
	);
}

/** The last search, kept while the panel goes to an issue and back. */
let lastSearch = "";

/** The clerk's list: the issues assigned to the operator, or what a search across every issue found. */
function ClerkBoard({ onOpen }: { onOpen: (key: string) => void }) {
	const state = useSyncExternalStore(atlassian.subscribe, atlassian.get);
	const theme = useTheme();
	const [query, setQuery] = useState(lastSearch);
	const [found, setFound] = useState<{ query: string; issues?: JiraIssue[]; reason?: string; loading?: boolean }>();
	const signedOut = state.signedIn === null || state.assigned.state === "signed-out";
	const assigned = "items" in state.assigned ? state.assigned.items : undefined;

	useEffect(() => {
		void atlassian.loadAssigned();
	}, []);

	// Search as the operator types (a moment after he stops), or at once on Enter.
	const searched = useRef(0);
	const search = async (text: string) => {
		const words = text.trim();
		lastSearch = text;
		const turn = ++searched.current;
		if (!words) return setFound(undefined);
		setFound((now) => ({ query: words, issues: now?.issues, loading: true }));
		try {
			const result = await atlassian.get().api?.jiraSearch?.(words);
			if (turn !== searched.current) return;
			if (!result) return setFound({ query: words, reason: "Agent World is not connected." });
			setFound(result.ok ? { query: words, issues: result.issues } : { query: words, reason: result.reason });
		} catch (error) {
			if (turn === searched.current) setFound({ query: words, reason: failure(error) });
		}
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: search is redefined each render; the query drives it
	useEffect(() => {
		const timer = setTimeout(() => void search(query), query.trim().length >= 2 ? 450 : 0);
		return () => clearTimeout(timer);
	}, [query]);

	const portrait = theme ? portraitOf(theme, "clerk", assigned?.length ? "happy" : "neutral") : undefined;
	const title = theme?.labels["quest-office"] ?? "";
	const searching = !!query.trim();
	const issues = searching ? found?.issues : assigned;

	return (
		<>
			<header className="aw-place-head">
				<div className="aw-place-portrait">
					{portrait && <img src={portrait} alt={theme?.labels.clerk} draggable={false} />}
				</div>
				<div className="aw-place-heading">
					<h2>{title}</h2>
					<p className="aw-place-says">&ldquo;{greeting(theme, state.assigned, signedOut)}&rdquo;</p>
				</div>
				{signedOut && (
					<button
						type="button"
						className="aw-button aw-button-strong aw-place-act"
						onClick={() => atlassian.askSignIn()}
					>
						Sign in from Settings
					</button>
				)}
			</header>
			{!signedOut && (
				<form
					className="aw-quest-search"
					onSubmit={(event) => {
						event.preventDefault();
						void search(query);
					}}
				>
					<input
						type="search"
						className="aw-place-search"
						placeholder={say(theme, "quest-search")}
						aria-label="Search every issue"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</form>
			)}
			{!signedOut && (
				<div className="aw-place-scroll">
					<section className="aw-place-section" aria-label={searching ? "Search results" : "Assigned to you"}>
						<h3 className="aw-quest-section">
							<span>{searching ? `Every issue matching \u201c${query.trim()}\u201d` : "Assigned to you"}</span>
							{issues && <small>{issues.length}</small>}
							{(searching ? found?.loading : state.assigned.state === "loading") && (
								<span className="aw-progress aw-progress-sending">Reading&hellip;</span>
							)}
						</h3>
						{searching && found?.reason && (
							<p className="aw-progress aw-progress-failed" role="alert">
								{found.reason}
							</p>
						)}
						{!searching && state.assigned.state === "failed" && (
							<p className="aw-progress aw-progress-failed" role="alert">
								{state.assigned.reason}
							</p>
						)}
						{issues && issues.length > 0 && (
							<ul className="aw-place-list aw-quest-list" aria-label={searching ? "Search results" : "Your issues"}>
								{issues.map((issue) => (
									<IssueRow key={issue.key} issue={issue} theme={theme} onOpen={() => onOpen(issue.key)} />
								))}
							</ul>
						)}
						{issues && issues.length === 0 && (
							<p className="aw-place-empty">
								{searching ? "No issue matches that." : "Nothing is assigned to you. Search finds any issue."}
							</p>
						)}
					</section>
				</div>
			)}
		</>
	);
}

function IssueRow({ issue, theme, onOpen }: { issue: JiraIssue; theme: Theme | undefined; onOpen: () => void }) {
	const kind = noticeOf(issue);
	const updated = since(issue.updated);
	return (
		<li className="aw-quest-row">
			<button type="button" className="aw-quest-main" onClick={onOpen} title={`Read ${issue.key}`}>
				<NoticeIcon theme={theme} kind={kind} />
				<span className="aw-quest-text">
					<span className="aw-quest-title">
						<span className="aw-jira-key">{issue.key}</span>
						<span className="aw-quest-summary">{issue.summary}</span>
					</span>
					<span className="aw-quest-meta">
						{[issue.type, issue.priority && `${issue.priority} priority`, issue.project]
							.filter(Boolean)
							.join(" \u00b7 ")}
					</span>
				</span>
				<span className="aw-quest-side">
					<StatusPill issue={issue} />
					{updated && <span className="aw-quest-time">{updated === "now" ? "just now" : `${updated} ago`}</span>}
				</span>
			</button>
		</li>
	);
}

type Doing =
	| { kind: "comment" }
	| { kind: "move" }
	| { kind: "hand" }
	| { kind: "confirm"; intent: OutsideWriteIntent; verb: string; after: "comment" | "move" };

/** One issue: what it is, its description and comments, and what the operator can do with it. */
function IssueView({
	issueKey,
	world,
	onBack,
}: {
	issueKey: string;
	world: WorldSnapshot | undefined;
	onBack?: () => void;
}) {
	const theme = useTheme();
	const state = useSyncExternalStore(atlassian.subscribe, atlassian.get);
	const site = state.signedIn?.site;
	const [detail, setDetail] = useState<JiraIssueDetail>();
	const [reason, setReason] = useState<string>();
	const [signedOut, setSignedOut] = useState(false);
	const [doing, setDoing] = useState<Doing>();
	const [comment, setComment] = useState("");
	const [transitions, setTransitions] = useState<{ list?: JiraTransition[]; reason?: string }>();
	const [result, setResult] = useState<Progress>();
	const reads = useRef(0);

	const read = async () => {
		const turn = ++reads.current;
		try {
			const api = atlassian.get().api;
			if (!api?.jiraIssue) throw new Error("Agent World is not connected.");
			const got = await api.jiraIssue(issueKey);
			if (turn !== reads.current) return;
			if (got.ok) {
				setDetail(got.detail);
				setReason(undefined);
			} else {
				setReason(got.reason);
				setSignedOut(got.signIn === "atlassian");
			}
		} catch (error) {
			if (turn === reads.current) setReason(failure(error));
		}
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: read once per issue (the view is keyed by it)
	useEffect(() => {
		void read();
	}, []);

	const loadTransitions = async () => {
		setTransitions(undefined);
		try {
			const api = atlassian.get().api;
			if (!api?.jiraTransitions) throw new Error("Agent World is not connected.");
			const got = await api.jiraTransitions(issueKey);
			setTransitions(got.ok ? { list: got.transitions } : { reason: got.reason });
		} catch (error) {
			setTransitions({ reason: failure(error) });
		}
	};

	const sent = (what: "comment" | "move", outcome: WriteResult) => {
		setDoing(undefined);
		if (outcome.ok && outcome.entry.ok) {
			setResult({
				state: "done",
				text: what === "comment" ? "Your comment is on the issue." : `Moved: ${outcome.entry.text}.`,
			});
			if (what === "comment") setComment("");
			void read();
			void atlassian.loadAssigned();
		} else
			setResult({
				state: "failed",
				text: outcome.ok ? (outcome.entry.reason ?? "Jira did not take it.") : outcome.reason,
			});
	};

	const issue = detail?.issue;
	const kind = issue ? noticeOf(issue) : "open";
	const facts: [string, string | null | undefined][] = issue
		? [
				["Type", issue.type],
				["Priority", issue.priority],
				["Project", issue.project],
				["Assignee", issue.assignee ?? "Unassigned"],
				["Reporter", detail?.reporter],
				["Created", when(detail?.created)],
				["Updated", when(issue.updated)],
			]
		: [];

	return (
		<>
			<header className="aw-place-head aw-issue-head">
				<NoticeIcon theme={theme} kind={kind} />
				<div className="aw-place-heading">
					<p className="aw-issue-key">
						{onBack && (
							<button type="button" className="aw-back" onClick={onBack} title="Back to the list">
								<span aria-hidden="true">&larr;</span> Back
							</button>
						)}
						<span className="aw-jira-key">{issueKey}</span>
						{issue && <StatusPill issue={issue} />}
					</p>
					<h2>{issue?.summary ?? (reason ? "This issue could not be read" : "Reading\u2026")}</h2>
				</div>
			</header>
			{reason && !detail && (
				<div className="aw-issue-failed">
					<p className="aw-progress aw-progress-failed" role="alert">
						{reason}
					</p>
					{signedOut && (
						<button type="button" className="aw-button aw-button-strong" onClick={() => atlassian.askSignIn()}>
							Sign in from Settings
						</button>
					)}
				</div>
			)}
			{issue && (
				<>
					<div className="aw-issue-actions" role="toolbar" aria-label="What to do with it">
						<button type="button" className="aw-button" onClick={() => void atlassian.openLink(issue.url)}>
							Open in Jira
						</button>
						<button
							type="button"
							className="aw-button"
							aria-pressed={doing?.kind === "comment"}
							onClick={() => {
								setResult(undefined);
								setDoing(doing?.kind === "comment" ? undefined : { kind: "comment" });
							}}
						>
							Comment
						</button>
						<button
							type="button"
							className="aw-button"
							aria-pressed={doing?.kind === "move"}
							onClick={() => {
								setResult(undefined);
								if (doing?.kind === "move") return setDoing(undefined);
								setDoing({ kind: "move" });
								void loadTransitions();
							}}
						>
							Move
						</button>
						<button
							type="button"
							className="aw-button aw-button-strong"
							aria-pressed={doing?.kind === "hand"}
							onClick={() => {
								setResult(undefined);
								setDoing(doing?.kind === "hand" ? undefined : { kind: "hand" });
							}}
						>
							Hand to the coordinator
						</button>
					</div>
					{result && (
						<p className={`aw-progress aw-progress-${result.state} aw-issue-result`} role="status">
							{result.text}
						</p>
					)}
					{doing?.kind === "comment" && (
						<form
							className="aw-issue-compose"
							onSubmit={(event) => {
								event.preventDefault();
								if (comment.trim())
									setDoing({
										kind: "confirm",
										intent: { kind: "jira-comment", key: issue.key, body: comment.trim() },
										verb: "Comment as you",
										after: "comment",
									});
							}}
						>
							<textarea
								// biome-ignore lint/a11y/noAutofocus: the operator just asked to write a comment
								autoFocus
								className="aw-issue-comment"
								aria-label={`Your comment on ${issue.key}`}
								placeholder={`Your comment on ${issue.key}, posted as you`}
								rows={4}
								value={comment}
								onChange={(event) => setComment(event.target.value)}
							/>
							<div className="aw-issue-compose-actions">
								<span className="aw-hand-hint">You see exactly what is posted before it goes.</span>
								<button type="button" className="aw-button" onClick={() => setDoing(undefined)}>
									Cancel
								</button>
								<button type="submit" className="aw-button aw-button-strong" disabled={!comment.trim()}>
									Review and post&hellip;
								</button>
							</div>
						</form>
					)}
					{doing?.kind === "move" && (
						<fieldset className="aw-issue-moves" aria-label="Move to">
							<legend>Move {issue.key}</legend>
							{!transitions && (
								<p className="aw-progress aw-progress-sending">Asking Jira which moves it allows&hellip;</p>
							)}
							{transitions?.reason && (
								<p className="aw-progress aw-progress-failed" role="alert">
									{transitions.reason}
								</p>
							)}
							{transitions?.list && transitions.list.length === 0 && (
								<p className="aw-place-empty">Jira offers no move for this issue now.</p>
							)}
							{transitions?.list && transitions.list.length > 0 && (
								<ul className="aw-issue-move-list">
									{transitions.list.map((move) => (
										<li key={move.id}>
											<button
												type="button"
												className={`aw-move aw-move-${move.toCategory === "done" ? "done" : move.toCategory === "indeterminate" ? "doing" : "todo"}`}
												onClick={() =>
													setDoing({
														kind: "confirm",
														intent: { kind: "jira-transition", key: issue.key, transition: move.id },
														verb: "Move it",
														after: "move",
													})
												}
											>
												<span className="aw-move-name">{move.name}</span>
												{move.to && move.to !== move.name && <small>to {move.to}</small>}
											</button>
										</li>
									))}
								</ul>
							)}
						</fieldset>
					)}
					{doing?.kind === "hand" && (
						<HandOver
							world={world}
							item={{ kind: "issue", key: issue.key, summary: issue.summary, url: issue.url }}
							asks={[{ ask: "start-work", label: "Start work on it" }]}
							fixedTo="coordinator"
							title={`Hand ${issue.key} to the coordinator`}
							hint="It reaches your coordinator as an instruction to start work. Nothing is written to Jira."
							onClose={() => setDoing(undefined)}
						/>
					)}
					<div className="aw-place-scroll aw-issue-scroll">
						<div className="aw-issue-layout">
							<div className="aw-issue-main">
								<section className="aw-place-section" aria-label="Description">
									<h3>Description</h3>
									<RichView
										html={detail?.descriptionHtml}
										text={detail?.descriptionText}
										base={site}
										className="aw-issue-description"
										empty="No description."
									/>
								</section>
								<Comments detail={detail} site={site} />
							</div>
							<dl className="aw-issue-facts" aria-label="Details">
								{facts
									.filter(([, value]) => value)
									.map(([name, value]) => (
										<div key={name}>
											<dt>{name}</dt>
											<dd>{value}</dd>
										</div>
									))}
							</dl>
						</div>
					</div>
				</>
			)}
			{doing?.kind === "confirm" && (
				<GatedWrite
					intent={doing.intent}
					verb={doing.verb}
					onCancel={() => setDoing(doing.after === "comment" ? { kind: "comment" } : { kind: "move" })}
					onSent={(outcome) => sent(doing.after, outcome)}
				/>
			)}
		</>
	);
}

function Comments({ detail, site }: { detail: JiraIssueDetail | undefined; site: string | undefined }) {
	const comments = useMemo(() => detail?.comments ?? [], [detail]);
	return (
		<section className="aw-place-section" aria-label="Comments">
			<h3>
				Comments <small>{comments.length || ""}</small>
			</h3>
			{comments.length === 0 && <p className="aw-place-empty">No comments yet.</p>}
			<ol className="aw-issue-comments">
				{comments.map((comment) => (
					<li key={comment.id} className="aw-issue-comment-row">
						<p className="aw-issue-comment-by">
							<strong>{comment.author ?? "Someone"}</strong>
							{comment.created && <span>{when(comment.created)}</span>}
						</p>
						<RichView html={comment.html} text={comment.text} base={site} />
					</li>
				))}
			</ol>
		</section>
	);
}

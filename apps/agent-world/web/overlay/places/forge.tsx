// The forge's panel (tickets 21-23), in the theme's words: the smith's list of every open pull request that involves
// the operator or his agents, each with its CI state; one pull request's card (title, repository, author, branch, CI
// and its checks, review state, the agent whose branch it is) with Open in GitHub, Review, and delegation; and the
// review page (`review.tsx`). Delegating asks the agent who built it to address the review, or the coordinator to get
// it reviewed: an ordinary instruction that never writes to GitHub. With no agent linked, only the coordinator is
// offered.
import { type ReactNode, useState, useSyncExternalStore } from "react";
import type { CiState, PullRequest } from "../../../src/integrations.js";
import type { Character, WorldSnapshot } from "../../../src/world.js";
import { portraitFor, portraitOf } from "../../looks.js";
import { say } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import { markdownHtml } from "../conversation/markdown.js";
import { activity, ago } from "../interface/model.js";
import { type ForgeDelegation, forge, prKey } from "./forge-state.js";
import "./forge.css";
import { PlaceDialog } from "./place-dialog.js";
import { ReviewPage } from "./review.js";

export const CI_WORDS: Record<CiState, string> = {
	passing: "Passing",
	failing: "Failing",
	running: "Running",
	none: "No checks",
};

const REVIEW_WORDS: Record<string, string> = {
	APPROVED: "Approved",
	CHANGES_REQUESTED: "Changes requested",
	REVIEW_REQUIRED: "Review required",
};

/** The CI state as a small mark: a tick, a cross, a turning ring, or a dash; its word for screen readers. */
export function CiMark({ ci, large }: { ci: CiState; large?: boolean }) {
	return (
		<span
			className={`aw-ci aw-ci-${ci}${large ? " aw-ci-large" : ""}`}
			role="img"
			aria-label={`CI ${CI_WORDS[ci].toLowerCase()}`}
			title={`CI ${CI_WORDS[ci].toLowerCase()}`}
		/>
	);
}

/** The coordinator a delegation about `near`'s work goes to: the one it reports to, else the first awake one. */
export function coordinatorFor(world: WorldSnapshot | undefined, near?: string): Character | undefined {
	const characters = world?.characters ?? [];
	const find = (id: string | null | undefined) => (id ? characters.find((c) => c.id === id) : undefined);
	const theirs = find(near ? find(near)?.facts?.reportsTo : undefined);
	if (theirs?.role === "coordinator") return theirs;
	for (const hq of world?.headquarters ?? []) {
		const coordinator = find(hq.id);
		if (coordinator) return coordinator;
	}
	return characters.find((c) => c.role === "coordinator");
}

/** The forge's panel while it is open, afresh on each opening. */
export function ForgePanels({ world }: { world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(forge.subscribe, forge.get);
	return state.page ? <ForgePanel key={state.opening} world={world} /> : null;
}

function ForgePanel({ world }: { world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(forge.subscribe, forge.get);
	const theme = useTheme();
	const title = theme?.labels.forge ?? "The forge";
	const pr = forge.find(state.selected);
	const page = state.page === "list" || !pr ? "list" : state.page;
	const label = page === "list" ? title : page === "review" ? `Review #${pr?.number}` : `Pull request #${pr?.number}`;
	return (
		<PlaceDialog label={label} className={`aw-forge aw-forge-${page}`} onClose={() => forge.escape()}>
			{page === "list" && <ForgeList world={world} />}
			{page === "card" && pr && <PullRequestCard pr={pr} world={world} />}
			{page === "review" && pr && <ReviewPage pr={pr} />}
		</PlaceDialog>
	);
}

/** "read 2m ago", or "reading..." */
function readWhen(at: number | undefined, loading: boolean) {
	if (loading) return "Reading GitHub\u2026";
	const when = ago(at);
	return when ? `Read ${when === "now" ? "just now" : `${when} ago`}` : "";
}

function ForgeList({ world }: { world: WorldSnapshot | undefined }) {
	const { list } = useSyncExternalStore(forge.subscribe, forge.get);
	const theme = useTheme();
	const [search, setSearch] = useState("");
	const prs = list.pullRequests;
	const loading = list.state === "loading" || list.state === "idle";
	const failed = list.state === "failed";
	const host = theme ? portraitOf(theme, "smith", failed ? "worried" : prs.length ? "happy" : "neutral") : undefined;
	const greeting =
		failed && !prs.length
			? (list.reason ?? "")
			: loading && !prs.length
				? say(theme, "forge-loading")
				: prs.length
					? say(theme, "forge-greeting")
					: say(theme, "forge-empty");
	const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const rows = prs.filter((pr) => {
		if (!words.length) return true;
		const text = [pr.title, pr.repo, `#${pr.number}`, pr.branch, pr.author, pr.agent?.name].join(" ").toLowerCase();
		return words.every((word) => text.includes(word));
	});
	const counts = (["failing", "running", "passing", "none"] as const)
		.map((ci) => ({ ci, n: prs.filter((pr) => pr.ci === ci).length }))
		.filter(({ n }) => n > 0);

	return (
		<>
			<header className="aw-place-head">
				<div className="aw-place-portrait">
					{host && <img src={host} alt={theme?.labels.smith} draggable={false} />}
				</div>
				<div className="aw-place-heading">
					<h2>{theme?.labels.forge}</h2>
					<p className="aw-place-says">&ldquo;{greeting}&rdquo;</p>
				</div>
				<div className="aw-forge-read">
					<span className="aw-forge-when" role="status">
						{readWhen(list.at, list.state === "loading")}
					</span>
					<button
						type="button"
						className="aw-button"
						disabled={list.state === "loading"}
						onClick={() => void forge.refresh()}
						title="Read the pull requests from GitHub again"
					>
						Read again
					</button>
				</div>
			</header>
			{failed && prs.length > 0 && (
				<p className="aw-progress aw-progress-failed aw-forge-stale" role="status">
					Showing the last list: {list.reason}
				</p>
			)}
			{failed && list.signIn === "github" && (
				<div className="aw-forge-signin">
					<p>
						The forge reads GitHub through the GitHub CLI as you. In a terminal, run <code>gh auth login</code>, then
						choose Read again.
					</p>
				</div>
			)}
			{prs.length > 0 && (
				<div className="aw-forge-tools">
					<input
						type="search"
						className="aw-place-search"
						placeholder="Search by title, repository, or branch"
						aria-label="Search the pull requests"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
					<ul className="aw-forge-tally" aria-label="CI states">
						{counts.map(({ ci, n }) => (
							<li key={ci} className={`aw-forge-count aw-forge-count-${ci}`}>
								<CiMark ci={ci} />
								{n} {CI_WORDS[ci].toLowerCase()}
							</li>
						))}
					</ul>
				</div>
			)}
			{loading && !prs.length && !failed && (
				<ul className="aw-place-list aw-forge-list" aria-label="Loading">
					{[0, 1, 2].map((n) => (
						<li key={n} className="aw-forge-row aw-forge-ghost" aria-hidden="true" />
					))}
				</ul>
			)}
			{prs.length > 0 && (
				<ul className="aw-place-list aw-forge-list" aria-label="Open pull requests">
					{rows.map((pr) => (
						<PullRequestRow key={prKey(pr)} pr={pr} world={world} />
					))}
				</ul>
			)}
			{prs.length > 0 && rows.length === 0 && <p className="aw-place-empty">No pull request matches that.</p>}
		</>
	);
}

function AgentChip({ agent, world }: { agent: { id: string; name: string }; world: WorldSnapshot | undefined }) {
	const theme = useTheme();
	const character = world?.characters.find((c) => c.id === agent.id);
	const face = theme && character ? portraitFor(theme, character) : undefined;
	return (
		<span className="aw-forge-agent" title={`${agent.name} works on this branch`}>
			<span className="aw-forge-agent-face">{face && <img src={face} alt="" draggable={false} />}</span>
			{agent.name}
		</span>
	);
}

function PullRequestRow({ pr, world }: { pr: PullRequest; world: WorldSnapshot | undefined }) {
	const updated = ago(pr.updatedAt ? Date.parse(pr.updatedAt) : null);
	const review = pr.reviewDecision ? REVIEW_WORDS[pr.reviewDecision] : undefined;
	return (
		<li className={`aw-forge-row aw-forge-row-${pr.ci}`}>
			<button
				type="button"
				className="aw-forge-main"
				onClick={() => forge.openCard(pr)}
				aria-label={`#${pr.number} ${pr.title}, ${CI_WORDS[pr.ci].toLowerCase()}, in ${pr.repo}`}
			>
				<CiMark ci={pr.ci} />
				<span className="aw-forge-text">
					<span className="aw-forge-title">
						<span className="aw-forge-number">#{pr.number}</span> {pr.title}
					</span>
					<span className="aw-forge-detail">
						<span className="aw-forge-repo">{pr.repo}</span>
						{pr.author && <span> &middot; {pr.author}</span>}
						{pr.branch && (
							<>
								{" \u00b7 "}
								<code className="aw-forge-branch">{pr.branch}</code>
							</>
						)}
					</span>
				</span>
				<span className="aw-forge-side">
					{updated && <span className="aw-forge-time">{updated === "now" ? "just now" : updated}</span>}
					<span className="aw-forge-tags">
						{pr.draft && <span className="aw-forge-tag aw-forge-tag-draft">Draft</span>}
						{review && (
							<span className={`aw-forge-tag aw-forge-tag-${pr.reviewDecision?.toLowerCase()}`}>{review}</span>
						)}
						{pr.agent && <AgentChip agent={pr.agent} world={world} />}
					</span>
				</span>
			</button>
		</li>
	);
}

/** A pull request's description as GitHub-flavoured Markdown, its hidden HTML comments left out; links open outside. */
function Description({ body }: { body: string }) {
	const text = body.replace(/<!--[\s\S]*?-->/g, "").trim();
	if (!text) return <p className="aw-place-empty">No description.</p>;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: link clicks inside the rendered Markdown open in the browser; the links themselves take the keyboard
		<div
			className="aw-forge-body aw-md"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: rendered by markdownHtml, which escapes raw HTML
			dangerouslySetInnerHTML={{ __html: markdownHtml(text) }}
			onClick={(event) => {
				const link = (event.target as HTMLElement).closest("a");
				if (!link) return;
				event.preventDefault();
				void forge.get().api?.openLink?.(link.href);
			}}
			onKeyDown={() => {}}
		/>
	);
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
	return (
		<div className="aw-forge-fact">
			<dt>{term}</dt>
			<dd>{children}</dd>
		</div>
	);
}

/** One pull request: what it is, its CI and review, who built it, and what can be done with it. */
function PullRequestCard({ pr, world }: { pr: PullRequest; world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(forge.subscribe, forge.get);
	const key = prKey(pr);
	const detail = state.details[key];
	const checks = detail?.detail?.checks ?? [];
	const base = detail?.detail?.baseBranch;
	const review = pr.reviewDecision ? REVIEW_WORDS[pr.reviewDecision] : "No review yet";
	const { checks: count } = pr;
	const ciLine =
		pr.ci === "none"
			? "No checks ran"
			: pr.ci === "failing"
				? `${count.failing} of ${count.total} failing${count.running ? `, ${count.running} still running` : ""}`
				: pr.ci === "running"
					? `${count.running} of ${count.total} still running`
					: `All ${count.total} passing`;
	return (
		<div className="aw-forge-card">
			<nav className="aw-forge-crumbs">
				<button type="button" className="aw-forge-back" onClick={() => forge.back()}>
					All pull requests
				</button>
			</nav>
			<header className="aw-forge-card-head">
				<CiMark ci={pr.ci} large />
				<div className="aw-forge-card-heading">
					<h2>
						{pr.title}
						{pr.draft && <span className="aw-forge-tag aw-forge-tag-draft">Draft</span>}
					</h2>
					<p className="aw-forge-card-meta">
						<span className="aw-forge-repo">{pr.repo}</span> <span className="aw-forge-number">#{pr.number}</span>
						{pr.author && <> &middot; opened by {pr.author}</>}
					</p>
				</div>
			</header>
			<div className="aw-place-scroll aw-forge-card-scroll">
				<dl className="aw-forge-facts">
					<Fact term="Branch">
						{pr.branch ? <code className="aw-forge-branch">{pr.branch}</code> : "Unknown"}
						{base && (
							<>
								<span className="aw-forge-into" aria-hidden="true">
									{" \u2192 "}
								</span>
								<span className="aw-sr"> into </span>
								<code className="aw-forge-branch">{base}</code>
							</>
						)}
					</Fact>
					<Fact term="CI">
						<span className={`aw-forge-ci aw-forge-ci-${pr.ci}`}>
							{CI_WORDS[pr.ci]}
							<span className="aw-forge-quiet"> &middot; {ciLine}</span>
						</span>
					</Fact>
					<Fact term="Review">{review}</Fact>
					<Fact term="Built by">
						{pr.agent ? (
							<AgentLine id={pr.agent.id} name={pr.agent.name} world={world} />
						) : (
							<span className="aw-forge-quiet">No agent works on this branch now.</span>
						)}
					</Fact>
				</dl>
				{checks.length > 0 && <Checks checks={checks} open={pr.ci === "failing"} />}
				{detail?.detail && (
					<details className="aw-forge-description">
						<summary>Description</summary>
						<Description body={detail.detail.body} />
					</details>
				)}
				{detail?.state === "failed" && (
					<p className="aw-progress aw-progress-failed" role="status">
						{detail.reason}
					</p>
				)}
				<Delegate pr={pr} world={world} />
			</div>
			<footer className="aw-forge-actions">
				<button type="button" className="aw-button" onClick={() => void forge.openInGitHub(pr)}>
					Open in GitHub
				</button>
				<button type="button" className="aw-button aw-button-strong" onClick={() => forge.openReview(pr)}>
					Review the changes
				</button>
			</footer>
		</div>
	);
}

const ORDER = { failing: 0, running: 1, passing: 2, skipped: 3 } as const;
/** Checks listed before "Show all": a busy repository runs dozens, and the failing ones come first. */
const CHECKS_SHOWN = 8;

/** The pull request's checks, failing first, then running, passing, and skipped; the rest behind "Show all". */
function Checks({ checks, open }: { checks: { name: string; state: keyof typeof ORDER }[]; open: boolean }) {
	const [all, setAll] = useState(false);
	const sorted = checks.slice().sort((a, b) => ORDER[a.state] - ORDER[b.state]);
	const shown = all ? sorted : sorted.slice(0, CHECKS_SHOWN);
	return (
		<details className="aw-forge-checks" open={open}>
			<summary>
				Checks <span className="aw-forge-quiet">({checks.length})</span>
			</summary>
			<ul>
				{shown.map((check, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: checks may repeat a name; each read lists them afresh
					<li key={`${check.name}:${i}`} className={`aw-forge-check aw-forge-check-${check.state}`}>
						<CiMark ci={check.state === "skipped" ? "none" : check.state} />
						{check.name}
						<span className="aw-forge-quiet">{check.state}</span>
					</li>
				))}
			</ul>
			{sorted.length > shown.length && (
				<button type="button" className="aw-forge-link aw-forge-more" onClick={() => setAll(true)}>
					Show all {sorted.length} checks
				</button>
			)}
		</details>
	);
}

function AgentLine({ id, name, world }: { id: string; name: string; world: WorldSnapshot | undefined }) {
	const character = world?.characters.find((c) => c.id === id);
	return (
		<span className="aw-forge-built">
			<AgentChip agent={{ id, name }} world={world} />
			{character && <span className="aw-forge-quiet">{activity(character)}</span>}
		</span>
	);
}

const STAGES: { stage: "accepted" | "delivered" | "applied"; label: string }[] = [
	{ stage: "accepted", label: "Accepted" },
	{ stage: "delivered", label: "Delivered" },
	{ stage: "applied", label: "Applied" },
];

/**
 * Delegating follow-up: ask the agent whose branch it is to address the review, or the coordinator to get it
 * reviewed, with an optional note of the operator's own. Either is an ordinary instruction; nothing goes to GitHub.
 */
function Delegate({ pr, world }: { pr: PullRequest; world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(forge.subscribe, forge.get);
	const [note, setNote] = useState("");
	const sent = state.delegations[prKey(pr)];
	const builder = pr.agent ? world?.characters.find((c) => c.id === pr.agent!.id) : undefined;
	const coordinator = coordinatorFor(world, builder?.id);
	const ask = (what: ForgeDelegation["ask"]) => {
		if (what === "address-review" && builder) void forge.delegate(pr, what, builder, note);
		if (what === "get-reviewed" && coordinator)
			void forge.delegate(pr, what, { id: "coordinator", name: coordinator.name }, note, builder?.id);
	};
	const busy = sent && !sent.stages.some((s) => s === "applied" || s === "failed");

	return (
		<section className="aw-forge-ask" aria-label="Ask for help">
			<h3>Ask for help</h3>
			{sent ? (
				<DelegationReceipt pr={pr} sent={sent} />
			) : (
				<>
					<textarea
						className="aw-forge-note"
						aria-label="Add a note (optional)"
						placeholder={`Add a note for ${builder ? `${builder.name} or ` : ""}${coordinator?.name ?? "the coordinator"} (optional)`}
						rows={2}
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
					<div className="aw-forge-ask-actions">
						{builder && (
							<button type="button" className="aw-button" disabled={busy} onClick={() => ask("address-review")}>
								Ask {builder.name} to address the review
							</button>
						)}
						<button
							type="button"
							className="aw-button"
							disabled={busy || !coordinator}
							title={coordinator ? undefined : "No coordinator is awake."}
							onClick={() => ask("get-reviewed")}
						>
							Ask {coordinator?.name ?? "the coordinator"} to get it reviewed
						</button>
					</div>
					<p className="aw-forge-quiet aw-forge-ask-note">
						{builder
							? `${builder.name} gets it as a message in its conversation; nothing is written to GitHub.`
							: !coordinator
								? "No coordinator is awake to ask, and no agent works on this branch."
								: "No agent works on this branch, so the coordinator is the one to ask. Nothing is written to GitHub."}
					</p>
				</>
			)}
		</section>
	);
}

function DelegationReceipt({ pr, sent }: { pr: PullRequest; sent: ForgeDelegation }) {
	const failed = sent.stages.includes("failed");
	const applied = sent.stages.includes("applied");
	const how = sent.command === "follow_up" ? "after its current turn" : sent.command === "talk" ? "now" : "";
	const what = sent.ask === "address-review" ? "address the review" : "get it reviewed";
	return (
		<div className={`aw-forge-receipt aw-forge-receipt-${failed ? "failed" : applied ? "done" : "sending"}`}>
			<p className={`aw-progress aw-progress-${failed ? "failed" : applied ? "done" : "sending"}`} role="status">
				{failed
					? `Asking ${sent.toName} failed: ${sent.reason ?? "no reason given"}`
					: applied
						? `${sent.toName} has your request to ${what}${how ? `, ${how === "now" ? "and starts on it now" : how}` : ""}.`
						: `Asking ${sent.toName} to ${what}\u2026`}
			</p>
			{!failed && (
				<ol className="aw-forge-stages" aria-label="Receipt">
					{STAGES.map(({ stage, label }) => (
						<li key={stage} className={sent.stages.includes(stage) || applied ? "aw-on" : undefined}>
							{label}
						</li>
					))}
				</ol>
			)}
			{(failed || applied) && (
				<button type="button" className="aw-button" onClick={() => forge.clearDelegation(pr)}>
					{failed ? "Try again" : "Ask again"}
				</button>
			)}
		</div>
	);
}

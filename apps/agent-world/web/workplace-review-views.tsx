import type { ReactNode } from "react";
import type { FindingValidation } from "../../../components/code-review/src/contracts.js";
import type { FindingDecision, ReviewDecision } from "../../../components/code-review/src/decisions.js";
import {
	approvalLabel,
	changeLabel,
	dollarsLabel,
	elapsedLabel,
	refLabel,
	resultLabel,
	targetLabel,
	tokensLabel,
} from "../../../components/code-review/src/presentation.js";
import type {
	ReviewAssessment,
	ReviewAttemptLog,
	ReviewSource,
	ReviewSummary,
	ReviewThreadMessage,
} from "../../../components/code-review/src/results.js";
import type { ReviewConfiguration, ReviewRequest } from "../../../components/code-review/src/types.js";

/** Evidence views for the Reviews pane: each part rendered for reading, not as raw text or JSON. */

type Page<T> = { total: number; page: { offset: number; nextOffset: number | null; rows: T[] } | null };
type Tone = "done" | "live" | "warn" | "bad" | "muted";

const when = (at: number | null | undefined) => (at ? new Date(at).toLocaleString() : "--");
const short = (id: string | null | undefined) => (id ? id.slice(0, 10) : "--");

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
	return <i className={`wp-review-pill tone-${tone}`}>{children}</i>;
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
	return (
		<dl className="wp-review-facts">
			{rows.map(([label, value]) => (
				<div key={label}>
					<dt>{label}</dt>
					<dd>{value}</dd>
				</div>
			))}
		</dl>
	);
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
	return (
		<section className="wp-review-section">
			<h4>
				{title}
				{aside && <span>{aside}</span>}
			</h4>
			{children}
		</section>
	);
}

function Mono({ children, title }: { children: ReactNode; title?: string }) {
	return (
		<code className="wp-review-mono" title={title}>
			{children}
		</code>
	);
}

function Empty({ children }: { children: ReactNode }) {
	return <p className="wp-review-empty">{children}</p>;
}

/** Stable React keys for static text lists: the text itself, numbered when it repeats. */
function keyed<T>(items: T[], text: (item: T) => string): [string, T][] {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const base = text(item).slice(0, 80);
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return [`${base}#${count}`, item];
	});
}

const BULLET = /^\s*- /;

/** Plain text with blank-line paragraphs and "- " lines as bullets; never a code block. */
function Prose({ text }: { text: string }) {
	return (
		<div className="wp-review-prose">
			{keyed(text.split(/\n{2,}/), (block) => block).map(([key, block]) => {
				const lines = block.split("\n");
				const lead = BULLET.test(lines[0]!) ? null : lines[0]!;
				const bullets = lines.slice(lead === null ? 0 : 1);
				if (!bullets.length || !bullets.every((line) => BULLET.test(line))) return <p key={key}>{block}</p>;
				return (
					<div key={key}>
						{lead && <p>{lead}</p>}
						<ul>
							{keyed(bullets, (line) => line).map(([item, line]) => (
								<li key={item}>{line.replace(BULLET, "")}</li>
							))}
						</ul>
					</div>
				);
			})}
		</div>
	);
}

function stateTone(state: string): Tone {
	if (["failed", "interrupted", "cancelled"].includes(state)) return "bad";
	if (["incomplete", "cancelling", "challenged"].includes(state)) return "warn";
	if (["running", "starting", "cleaning", "queued", "capturing", "pending"].includes(state)) return "live";
	if (["completed", "no-changes", "matches"].includes(state)) return "done";
	return "muted";
}

function Meter({ value, total }: { value: number; total: number }) {
	const percent = total ? Math.round((value / total) * 100) : 0;
	return (
		<span className="wp-review-meter" title={`${value} of ${total}`}>
			<span style={{ width: `${percent}%` }} />
		</span>
	);
}

function SummaryView({ review }: { review: ReviewSummary }) {
	const coverage = review.coverage;
	return (
		<>
			<div className="wp-review-tiles">
				<div>
					<span>Status</span>
					<b>
						<Pill tone={stateTone(review.state)}>{review.state}</Pill>
					</b>
					<small>{review.phase ? `${review.phase.kind}: ${review.phase.pass}` : (review.reason ?? " ")}</small>
				</div>
				<div>
					<span>Findings</span>
					<b className={review.findings.confirmed > review.findings.responded ? "tone-warn" : ""}>
						{resultLabel(review)}
					</b>
					<small>
						{review.findings.reported} reported · {review.findings.unresolved} unresolved
					</small>
				</div>
				<div>
					<span>Coverage</span>
					<b>{review.passes ? `${review.passes.completed}/${review.passes.required} passes` : "not planned"}</b>
					{coverage ? (
						<small>
							<Meter value={coverage.completedQuestions} total={coverage.requiredQuestions} />
							{coverage.completedQuestions}/{coverage.requiredQuestions} questions
						</small>
					) : (
						<small> </small>
					)}
				</div>
				<div>
					<span>Elapsed</span>
					<b>{elapsedLabel(review)}</b>
					<small>{review.settledAt === null ? "so far" : `settled ${when(review.settledAt)}`}</small>
				</div>
				<div>
					<span>Cost</span>
					<b>{dollarsLabel(review.cost.reportedDollars)}</b>
					<small>{tokensLabel(review.cost)}</small>
				</div>
			</div>
			{review.summary && (
				<Section title="Plan">
					<Prose text={review.summary} />
				</Section>
			)}
			<Section title="Details">
				<Facts
					rows={[
						[
							"Change",
							<>
								<b>
									{review.label.repository} / {refLabel(review)}
								</b>{" "}
								{changeLabel(review)}
							</>,
						],
						["Target", targetLabel(review.target)],
						["Owner", review.ownerName],
						["Intent", review.intent === "captured" ? "captured" : "not supplied; intent is not assessed"],
						["Approval", approvalLabel(review)],
						["Live freshness", "not checked; see Freshness"],
						["Priority", String(review.priority)],
						["Assessment", `revision ${review.revision}`],
						...(coverage
							? ([
									["Integration only", `${coverage.integrationOnlyRegions} changed regions outside every scope`],
									["Additional requests", String(coverage.additionalRequests)],
								] as [string, ReactNode][])
							: []),
						["Cost reported", `${review.cost.reportedAttempts} of ${review.cost.totalAttempts} attempts`],
					]}
				/>
			</Section>
			{review.reason && <p className="wp-review-callout">{review.reason}</p>}
			<p className="wp-review-meta">
				Completion is not approval or a correctness certificate. Cost covers recorded primary turns only.
			</p>
		</>
	);
}

export function FindingView({ entry }: { entry: ReviewAssessment["findings"][number] }) {
	const { finding } = entry;
	const field = (label: string, text: string) => (
		<div>
			<dt>{label}</dt>
			<dd>{text}</dd>
		</div>
	);
	return (
		<article className="wp-review-finding">
			<h4>
				<i className={`wp-review-severity is-${finding.severity}`}>{finding.severity}</i> {finding.title}
			</h4>
			<p className="wp-review-meta">
				{finding.path}:{finding.line} · validation {entry.validation?.disposition ?? "pending"} · response{" "}
				{entry.decision?.data.disposition ?? "none"} · {entry.id}
			</p>
			<dl>
				{field("Problem", finding.impact)}
				{field("Trigger", finding.trigger)}
				{field("Cause", finding.cause)}
				{field("Correction", finding.correction)}
			</dl>
			<details>
				<summary>Evidence and validation</summary>
				<FindingEvidence entry={entry} />
			</details>
		</article>
	);
}

function EvidenceList({ items }: { items: { kind: string; detail: string; provenance: string }[] | string[] }) {
	if (!items.length) return <Empty>None recorded.</Empty>;
	return (
		<ul className="wp-review-evidence">
			{keyed<(typeof items)[number]>(items, (item) => (typeof item === "string" ? item : item.detail)).map(
				([key, item]) =>
					typeof item === "string" ? (
						<li key={key}>{item}</li>
					) : (
						<li key={key}>
							<Pill tone="muted">{item.kind}</Pill> {item.detail}
							<small>{item.provenance}</small>
						</li>
					),
			)}
		</ul>
	);
}

function FindingEvidence({ entry }: { entry: ReviewAssessment["findings"][number] }) {
	const { finding, validation, decision } = entry;
	return (
		<div className="wp-review-finding-evidence">
			<Facts
				rows={[
					["Invariant", finding.invariant],
					["Certainty", finding.certainty],
					["Counterevidence", finding.counterevidence],
				]}
			/>
			<h5>Inspector evidence</h5>
			<EvidenceList items={finding.evidence} />
			<h5>Validation</h5>
			{validation ? <ValidationEntry entry={validation} /> : <Empty>Not yet validated.</Empty>}
			<h5>Owner response</h5>
			{decision ? <DecisionBody decision={decision} /> : <Empty>No response yet.</Empty>}
		</div>
	);
}

function ValidationEntry({ entry }: { entry: FindingValidation["findings"][number] }) {
	return (
		<div>
			<p>
				<Pill tone={entry.disposition === "confirmed" ? "warn" : entry.disposition === "rejected" ? "done" : "muted"}>
					{entry.disposition}
				</Pill>{" "}
				{entry.reason}
				{entry.duplicateOf && (
					<>
						{" "}
						Duplicate of <Mono>{entry.duplicateOf}</Mono>.
					</>
				)}
			</p>
			<EvidenceList items={entry.evidence} />
		</div>
	);
}

function DecisionBody({ decision, labelled = true }: { decision: FindingDecision; labelled?: boolean }) {
	return (
		<div>
			<p>
				{labelled && (
					<>
						<Pill tone={decision.data.disposition === "rejected" ? "muted" : "live"}>
							{decision.data.disposition}
						</Pill>{" "}
					</>
				)}
				{decision.data.reason}
			</p>
			{decision.data.scope && <p className="wp-review-meta">Scope: {decision.data.scope}</p>}
			<EvidenceList items={decision.data.evidence} />
		</div>
	);
}

function FindingsView({ data }: { data: Page<ReviewAssessment["findings"][number]> }) {
	if (!data.total) return <Empty>No reported findings. This does not establish correctness.</Empty>;
	return (
		<>
			{data.page?.rows.map((entry) => (
				<FindingView key={`${entry.attempt}:${entry.id}`} entry={entry} />
			))}
		</>
	);
}

function MailView({ data }: { data: Page<ReviewThreadMessage> }) {
	if (!data.total)
		return <Empty>No mail yet. The plan, confirmed findings, the outcome and comments appear here.</Empty>;
	return (
		<ol className="wp-review-thread">
			{data.page?.rows.map((message) => (
				<li key={message.seq} className={message.sender === "harness" ? "is-milestone" : "is-comment"}>
					<span className="wp-review-avatar" aria-hidden="true">
						{message.senderName.replace(/^the /, "").slice(0, 1).toUpperCase()}
					</span>
					<div>
						<p className="wp-review-meta">
							<b>{message.senderName}</b> · {when(message.at)}
						</p>
						<Prose text={message.body} />
					</div>
				</li>
			))}
		</ol>
	);
}

const LOG_KIND = { text: "said", tool: "ran", result: "result", error: "error" } as const;

function LogView({ data }: { data: ReviewAttemptLog[] }) {
	if (!data.length) return <Empty>No reviewer has started yet.</Empty>;
	return (
		<>
			{data.map((log) => (
				<section key={log.attempt} className="wp-review-card">
					<header>
						<b>{log.pass}</b>
						<Pill tone="muted">{log.kind}</Pill>
						<Pill tone={stateTone(log.state)}>{log.state}</Pill>
						<span className="wp-review-meta">{log.model ?? "model not recorded"}</span>
					</header>
					{log.entries.length ? (
						<ol className="wp-review-log">
							{keyed(log.entries, (entry) => `${entry.at}:${entry.text}`).map(([key, entry]) => (
								<li key={key} className={`is-${entry.kind}`}>
									<span>{LOG_KIND[entry.kind]}</span>
									{entry.kind === "text" ? <p>{entry.text}</p> : <Mono>{entry.text}</Mono>}
									<time>{entry.at ? new Date(entry.at).toLocaleTimeString() : ""}</time>
								</li>
							))}
						</ol>
					) : (
						<Empty>No transcript yet.</Empty>
					)}
				</section>
			))}
		</>
	);
}

type TargetData = {
	target: {
		digest: string;
		repository: string;
		source: string;
		requested: ReviewRequest;
		base: string | null;
		head: string | null;
		baseTree: string;
		headTree: string;
		baseRevision: string;
		headRevision: string;
		intent: { origin: string; text: string; hash: string } | null;
		configuration: { hash: string; roleReferences: number; catalogIssues: number } | null;
		files: number;
		regions: number;
		omissions: Page<{ path: string; reason: string }>;
	} | null;
	reason: string | null;
};

function TargetView({ data }: { data: TargetData }) {
	const target = data.target;
	if (!target) return <Empty>{data.reason ?? "The target has not been captured yet."}</Empty>;
	return (
		<>
			<Section title="Captured comparison">
				<Facts
					rows={[
						["Requested", targetLabel(target.requested.target)],
						["Repository", <Mono key="r">{target.repository}</Mono>],
						[
							"Base commit",
							<Mono key="b" title={target.base ?? undefined}>
								{target.base ? short(target.base) : "empty tree"}
							</Mono>,
						],
						[
							"Head commit",
							<Mono key="h" title={target.head ?? undefined}>
								{short(target.head)}
							</Mono>,
						],
						[
							"Base tree",
							<Mono key="bt" title={target.baseTree}>
								{short(target.baseTree)}
							</Mono>,
						],
						[
							"Review tree",
							<Mono key="ht" title={target.headTree}>
								{short(target.headTree)}
							</Mono>,
						],
						["Size", `${target.files} files, ${target.regions} changed regions`],
						["Scope", target.requested.paths?.length ? target.requested.paths.join(", ") : "all changed paths"],
						["Captured source", <Mono key="s">{target.source}</Mono>],
						[
							"Digest",
							<Mono key="d" title={target.digest}>
								{short(target.digest)}
							</Mono>,
						],
					]}
				/>
			</Section>
			<Section title="Intent">
				{target.intent ? (
					<>
						<p className="wp-review-meta">
							From <Mono>{target.intent.origin}</Mono> · hash <Mono>{short(target.intent.hash)}</Mono>
						</p>
						<Prose text={target.intent.text} />
					</>
				) : (
					<Empty>No approved intent was supplied, so intent compliance is not assessed.</Empty>
				)}
			</Section>
			<Section
				title="Limits"
				aside={
					target.omissions.total
						? `${target.omissions.total} ${target.omissions.total === 1 ? "path" : "paths"}`
						: undefined
				}
			>
				{target.omissions.total ? (
					<table className="wp-review-table-view">
						<tbody>
							{target.omissions.page?.rows.map((row) => (
								<tr key={`${row.path}:${row.reason}`}>
									<td>
										<Mono>{row.path}</Mono>
									</td>
									<td>{row.reason}</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<Empty>Every changed path was captured in full.</Empty>
				)}
			</Section>
		</>
	);
}

type Chunk = {
	id: string;
	title: string;
	/** Absent on plans recorded before scopes were paths. */
	paths?: string[];
	context: string[];
	risks?: { kind: string; reason: string }[];
	passes: {
		id: string;
		role: string;
		depth?: string;
		lenses: string[];
		questions: { id: string; question: string }[];
	}[];
	regions: string[];
};
type PlanData = {
	summary: string | null;
	integration: { role: string; depth?: string; questions: { id: string; question: string }[] } | null;
	unscopedRegions: string[];
	additionalWork: { id: string; question: string; reason: string }[];
	chunks: Page<Chunk>;
};

function PassRow({
	pass,
}: {
	pass: { id: string; role: string; depth?: string; lenses?: string[]; questions: { id: string; question: string }[] };
}) {
	return (
		<li className="wp-review-pass">
			<header>
				<b>{pass.id}</b>
				<span className="wp-review-meta">{pass.role}</span>
				{pass.depth === "deep" && <Pill tone="warn">deep</Pill>}
				{pass.lenses?.map((lens) => (
					<Pill key={lens} tone="muted">
						{lens}
					</Pill>
				))}
			</header>
			<ul>
				{pass.questions.map((question) => (
					<li key={question.id}>{question.question}</li>
				))}
			</ul>
		</li>
	);
}

function PlanView({ data }: { data: PlanData }) {
	if (!data.summary && !data.chunks.total) return <Empty>Not planned yet.</Empty>;
	return (
		<>
			{data.summary && (
				<Section title="Triage">
					<Prose text={data.summary} />
				</Section>
			)}
			{data.chunks.page?.rows.map((chunk) => (
				<section key={chunk.id} className="wp-review-card">
					<header>
						<b>{chunk.title}</b>
						<span className="wp-review-meta">
							{chunk.id} · {chunk.regions.length} {chunk.regions.length === 1 ? "region" : "regions"}
						</span>
					</header>
					{/* Plans recorded before scopes were paths name regions instead; they have no paths to show. */}
					{chunk.paths?.length ? (
						<p className="wp-review-chips">
							{chunk.paths.map((path) => (
								<Mono key={path}>{path}</Mono>
							))}
						</p>
					) : null}
					{chunk.risks?.length ? (
						<ul className="wp-review-risks">
							{chunk.risks.map((risk) => (
								<li key={`${risk.kind}:${risk.reason.slice(0, 20)}`}>
									<Pill tone="warn">{risk.kind}</Pill> {risk.reason}
								</li>
							))}
						</ul>
					) : null}
					<ul className="wp-review-passes">
						{chunk.passes.map((pass) => (
							<PassRow key={pass.id} pass={pass} />
						))}
					</ul>
				</section>
			))}
			{data.integration && (
				<section className="wp-review-card">
					<header>
						<b>Integration</b>
						<span className="wp-review-meta">
							whole change · {data.unscopedRegions.length} regions outside every scope
						</span>
					</header>
					<ul className="wp-review-passes">
						<PassRow pass={{ id: "integration", ...data.integration }} />
					</ul>
				</section>
			)}
			{data.additionalWork.length > 0 && (
				<Section title="Authorized additional work">
					<ul className="wp-review-evidence">
						{data.additionalWork.map((work) => (
							<li key={work.id}>
								{work.question}
								<small>{work.reason}</small>
							</li>
						))}
					</ul>
				</Section>
			)}
		</>
	);
}

type CoverageRow = {
	pass: string;
	question: { id: string; question: string; verification: string };
	state: string;
	reported: { state: string; evidence: string[]; reason: string } | null;
	challenge: { reason: string } | null;
};

function CoverageView({ data }: { data: Page<CoverageRow> }) {
	if (!data.total) return <Empty>No questions are planned yet.</Empty>;
	return (
		<ul className="wp-review-coverage">
			{data.page?.rows.map((row) => (
				<li key={`${row.pass}:${row.question.id}`}>
					<header>
						<Pill tone={stateTone(row.state)}>{row.state}</Pill>
						<b>{row.question.question}</b>
					</header>
					<p className="wp-review-meta">
						{row.pass} · settle by: {row.question.verification}
					</p>
					{row.challenge && <p className="wp-review-callout">Challenged: {row.challenge.reason}</p>}
					{row.reported?.evidence.length ? <EvidenceList items={row.reported.evidence} /> : null}
					{row.reported?.reason && <p>{row.reported.reason}</p>}
				</li>
			))}
		</ul>
	);
}

type AttemptRow = {
	id: string;
	pass: string;
	kind: string;
	role: string;
	state: string;
	model: string | null;
	thinking: string | null;
	reason: string | null;
	usage: { input?: number; output?: number; cacheRead?: number; cost?: { total?: number } } | null;
	createdAt: number;
	finishedAt: number | null;
	selected: boolean;
};

function AttemptsView({ data }: { data: Page<AttemptRow> }) {
	if (!data.total) return <Empty>No reviewer has started yet.</Empty>;
	return (
		<table className="wp-review-table-view">
			<thead>
				<tr>
					<th>Pass</th>
					<th>State</th>
					<th>Role and model</th>
					<th className="num">Time</th>
					<th className="num">Cost</th>
					<th>Used</th>
				</tr>
			</thead>
			<tbody>
				{data.page?.rows.map((row) => (
					<tr key={row.id} title={row.reason ?? undefined}>
						<td>
							<b>{row.pass}</b>
							<small>{row.kind}</small>
						</td>
						<td>
							<Pill tone={stateTone(row.state)}>{row.state}</Pill>
						</td>
						<td>
							{row.role}
							<small>
								{row.model ?? "--"}
								{row.thinking ? ` · ${row.thinking}` : ""}
							</small>
						</td>
						<td className="num">{elapsedLabel({ createdAt: row.createdAt, settledAt: row.finishedAt })}</td>
						<td className="num">{dollarsLabel(row.usage?.cost?.total ?? null)}</td>
						<td>{row.selected ? "selected" : ""}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function DecisionsView({ data }: { data: Page<ReviewDecision> }) {
	if (!data.total) return <Empty>No finding responses or sign-offs yet.</Empty>;
	return (
		<ul className="wp-review-coverage">
			{data.page?.rows.map((decision) => (
				<li key={decision.id}>
					<header>
						<Pill tone="muted">{decision.kind === "approval" ? "sign-off" : "finding response"}</Pill>
						<b>{decision.kind === "approval" ? decision.data.verdict : decision.data.disposition}</b>
						<span className="wp-review-meta">
							{decision.actor} · {when(decision.createdAt)} · revision {decision.revision}
						</span>
					</header>
					{decision.kind === "approval" ? (
						<>
							{decision.data.note && <p>{decision.data.note}</p>}
							{decision.data.limits.length > 0 && <EvidenceList items={decision.data.limits} />}
						</>
					) : (
						<>
							<p className="wp-review-meta">
								<Mono>{decision.finding}</Mono>
							</p>
							<DecisionBody decision={decision} labelled={false} />
						</>
					)}
				</li>
			))}
		</ul>
	);
}

function ConfigurationView({ data }: { data: { configuration: ReviewConfiguration | null; note: string } }) {
	const configuration = data.configuration;
	if (!configuration) return <Empty>This capture predates recorded review configuration.</Empty>;
	return (
		<>
			<Section
				title="Reviewer roles"
				aside={`${configuration.roleReferences.length} ${configuration.roleReferences.length === 1 ? "role" : "roles"}`}
			>
				<table className="wp-review-table-view">
					<tbody>
						{configuration.roleReferences.map((role) => (
							<tr key={role.role}>
								<td>
									<b>{role.role}</b>
								</td>
								<td>
									<span className="wp-review-chips">
										{role.models.map((model) => (
											<Mono key={model}>{model}</Mono>
										))}
									</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{configuration.catalogIssues > 0 && (
					<p className="wp-review-callout">{configuration.catalogIssues} role-catalog issues at capture.</p>
				)}
			</Section>
			<Section title="Instructions">
				{Object.entries(configuration.instructions).map(([name, text]) =>
					text ? (
						<details key={name} className="wp-review-instruction">
							<summary>{name}</summary>
							<Prose text={text} />
						</details>
					) : null,
				)}
			</Section>
			<p className="wp-review-meta">{data.note}</p>
		</>
	);
}

const FRESHNESS = {
	requestedTarget: ["Requested comparison", "The commits, trees, intent and review configuration the capture names."],
	checkout: ["Current checkout", "Whether the working tree today still holds the captured head."],
	policy: ["Review policy", "Whether reviewer roles and models resolve as they did for the recorded attempts."],
} as const;

function FreshnessView({
	data,
}: {
	data: {
		requestedTarget: string;
		checkout: string;
		policy: string;
		checkedAt: number;
		errors: string[];
		note: string;
	};
}) {
	return (
		<>
			<div className="wp-review-tiles is-three">
				{(Object.keys(FRESHNESS) as (keyof typeof FRESHNESS)[]).map((key) => (
					<div key={key}>
						<span>{FRESHNESS[key][0]}</span>
						<b>
							<Pill tone={data[key] === "matches" ? "done" : data[key] === "changed" ? "warn" : "muted"}>
								{data[key]}
							</Pill>
						</b>
						<small>{FRESHNESS[key][1]}</small>
					</div>
				))}
			</div>
			<p className="wp-review-meta">Checked {when(data.checkedAt)}. Switch tabs and back to check again.</p>
			{data.errors.length > 0 && (
				<Section title="Could not check">
					<EvidenceList items={data.errors} />
				</Section>
			)}
			<p className="wp-review-meta">{data.note}</p>
		</>
	);
}

export function SourceView({ source, onOpen }: { source: ReviewSource; onOpen(path: string): void }) {
	if (source.kind === "files")
		return (
			<>
				<p className="wp-review-meta">
					{source.total} captured files on the {source.side} side. Open one to read it.
				</p>
				<ul className="wp-review-files">
					{source.page?.rows.map((file) => (
						<li key={file.path}>
							<button type="button" onClick={() => onOpen(file.path)}>
								{file.path}
							</button>
							<small>{file.mode === "120000" ? "link" : file.mode === "160000" ? "submodule" : ""}</small>
						</li>
					))}
				</ul>
			</>
		);
	return (
		<section className="wp-review-card">
			<header>
				<b>{source.file.path}</b>
				<Pill tone="muted">{source.side}</Pill>
				<span className="wp-review-meta">{source.representation}</span>
			</header>
			{source.page?.rows.length ? (
				<table className="wp-review-code">
					<tbody>
						{source.page.rows
							.map((line, index) => ({ number: source.page!.offset + index + 1, line }))
							.map(({ number, line }) => (
								<tr key={number}>
									<td>{number}</td>
									<td>{line}</td>
								</tr>
							))}
					</tbody>
				</table>
			) : (
				<Empty>No text lines.</Empty>
			)}
			<p className="wp-review-meta">{source.note}</p>
		</section>
	);
}

export function EvidenceView({ part, data }: { part: string; data: unknown }) {
	if (data === undefined) return <Empty>Loading evidence...</Empty>;
	switch (part) {
		case "summary":
			return <SummaryView review={data as ReviewSummary} />;
		case "findings":
			return <FindingsView data={data as Page<ReviewAssessment["findings"][number]>} />;
		case "mail":
			return <MailView data={data as Page<ReviewThreadMessage>} />;
		case "log":
			return <LogView data={data as ReviewAttemptLog[]} />;
		case "target":
			return <TargetView data={data as TargetData} />;
		case "plan":
			return <PlanView data={data as PlanData} />;
		case "coverage":
			return <CoverageView data={data as Page<CoverageRow>} />;
		case "attempts":
			return <AttemptsView data={data as Page<AttemptRow>} />;
		case "decisions":
			return <DecisionsView data={data as Page<ReviewDecision>} />;
		case "configuration":
			return <ConfigurationView data={data as { configuration: ReviewConfiguration | null; note: string }} />;
		case "freshness":
			return <FreshnessView data={data as Parameters<typeof FreshnessView>[0]["data"]} />;
		default:
			return <Empty>Unknown evidence view.</Empty>;
	}
}

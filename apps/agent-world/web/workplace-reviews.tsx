import { useCallback, useEffect, useRef, useState } from "react";
import { findingLines, summaryLines } from "../../../components/code-review/src/presentation.js";
import type {
	ReviewAssessment,
	ReviewQueue,
	ReviewSource,
	ReviewSummary,
} from "../../../components/code-review/src/results.js";
import type { ReviewRequest, ReviewTarget } from "../../../components/code-review/src/types.js";
import type { ReviewManagement, ReviewsApi } from "../src/reviews.js";
import type { WorldSnapshot } from "../src/world.js";
import "./workplace-reviews.css";

const parts = [
	"summary",
	"target",
	"source",
	"configuration",
	"freshness",
	"plan",
	"findings",
	"coverage",
	"attempts",
	"decisions",
] as const;
type Part = (typeof parts)[number];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function WorkplaceReviews({ root, active, world }: { root: string; active: boolean; world: WorldSnapshot }) {
	const api = window.agentWorld.reviews;
	const [queueState, setQueue] = useState<{ root: string; value: ReviewQueue }>();
	const queue = queueState?.root === root ? queueState.value : undefined;
	const [selected, select] = useState<string>();
	const [offset, setOffset] = useState(0);
	const [limit, setLimit] = useState(1);
	const list = useRef<HTMLElement>(null);
	const [part, setPart] = useState<Part>("summary");
	const [detailState, setDetail] = useState<{ key: string; value: unknown }>();
	const [detailOffset, setDetailOffset] = useState(0);
	const [path, setPath] = useState("");
	const [side, setSide] = useState<"before" | "after">("after");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [version, refresh] = useState(0);
	const detailKey = JSON.stringify([selected, part, path, side, detailOffset, limit, version]);
	const detail = detailState?.key === detailKey ? detailState.value : undefined;
	const [capture, showCapture] = useState(false);
	const [question, setQuestion] = useState("");
	const [reason, setReason] = useState("");
	const [doneWhen, setDoneWhen] = useState("");
	const [pending, setPending] = useState<{ attempt: string; operation: ReviewManagement }>();
	const current = queue?.page?.rows.find((review) => review.id === selected);
	useEffect(() => {
		const element = list.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setLimit(Math.max(1, Math.floor(element.clientHeight / 112))));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Repository changes reset only local selection and paging.
	useEffect(() => {
		setOffset(0);
		select(undefined);
		setDetail(undefined);
	}, [root]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Explicit refresh invalidates this on-demand query.
	useEffect(() => {
		if (!active) return;
		let live = true;
		setError("");
		void api
			.queue({ ...(root ? { cwd: root } : {}), limit, offset })
			.then((value) => {
				if (!live) return;
				setQueue({ root, value });
				select((id) => (value.page?.rows.some((row) => row.id === id) ? id : value.page?.rows[0]?.id));
			})
			.catch((error) => {
				if (live) setError(errorText(error));
			});
		return () => {
			live = false;
		};
	}, [api, active, root, offset, limit, version]);
	useEffect(() => {
		if (!active || !selected) return;
		let live = true;
		setDetail(undefined);
		const request = { review: selected, limit, offset: detailOffset };
		const load =
			part === "source"
				? api.source({ ...request, side, ...(path ? { path } : {}) })
				: part === "freshness"
					? api.freshness({ review: selected })
					: api.read({ ...request, part });
		void load
			.then((value) => {
				if (live) setDetail({ key: detailKey, value });
			})
			.catch((error) => {
				if (live) setError(errorText(error));
			});
		return () => {
			live = false;
		};
	}, [api, active, selected, part, path, side, detailOffset, limit, detailKey]);
	const manage = useCallback(
		async (request: NonNullable<typeof pending>) => {
			setBusy(true);
			setError("");
			setPending(request);
			try {
				await api.manage(request);
				setPending(undefined);
				refresh((n) => n + 1);
			} catch (error) {
				setError(`${errorText(error)} The request may have applied; retry this exact request before creating another.`);
			} finally {
				setBusy(false);
			}
		},
		[api],
	);
	const action = (action: "cancel" | "resume", review: ReviewSummary) => {
		if (
			pending ||
			!window.confirm(
				`${action === "resume" ? "Resume reviewers on the same retained target? This can incur model cost." : "Cancel this review and wait for reviewer cleanup?"}\n${review.id}`,
			)
		)
			return;
		void manage({ attempt: crypto.randomUUID(), operation: { action, review: review.id } });
	};
	const data = detail as
		| {
				page?: { nextOffset: number | null };
				target?: { omissions?: { page?: { nextOffset: number | null } } };
				chunks?: { page?: { nextOffset: number | null } };
		  }
		| undefined;
	const next = (part === "target" ? data?.target?.omissions?.page : part === "plan" ? data?.chunks?.page : data?.page)
		?.nextOffset;
	return (
		<section className="wp-reviews" aria-label="Code reviews" hidden={!active}>
			<header>
				<div>
					<h2>Reviews</h2>
					<p>Captured code. Independent inspections. Exact-artifact sign-off.</p>
				</div>
				<button type="button" onClick={() => refresh((n) => n + 1)}>
					Refresh
				</button>
				<button type="button" onClick={() => showCapture(!capture)}>
					Capture review
				</button>
			</header>
			{error && (
				<div role="alert" className="wp-code-error">
					{error}
				</div>
			)}
			{pending && (
				<div className="wp-code-notice">
					Unconfirmed request retained.{" "}
					<button type="button" disabled={busy} onClick={() => void manage(pending)}>
						Retry exact request
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							if (
								window.confirm(
									"Forget only this local retry? This does not undo or cancel runtime work. Inspect the queue before making another request.",
								)
							)
								setPending(undefined);
						}}
					>
						Forget local retry
					</button>
				</div>
			)}
			{capture && (
				<ReviewCapture
					owners={[
						...world.characters.filter((person) => !person.facts?.temporary),
						...(world.dormant ?? []).filter((person) => !person.temporary),
					]}
					api={api}
					root={root}
					onQueued={() => {
						showCapture(false);
						refresh((n) => n + 1);
					}}
				/>
			)}
			<div className="wp-reviews-panes">
				<aside ref={list} aria-label="Review queue">
					{queue?.page?.rows.map((review) => (
						<button
							type="button"
							className={`wp-review-card ${selected === review.id ? "is-selected" : ""}`}
							key={review.id}
							onClick={() => {
								select(review.id);
								setDetailOffset(0);
							}}
						>
							<strong>
								{review.state} <small>{review.phase?.pass ?? ""}</small>
							</strong>
							<span>
								{review.target.kind} ·{" "}
								{review.passes ? `${review.passes.completed}/${review.passes.required} passes` : "not planned"} ·{" "}
								{review.findings.confirmed} confirmed
							</span>
							<span>
								{review.approval?.matchesAssessment ? review.approval.record.data.verdict : "not signed off"} ·{" "}
								{review.cost.reportedDollars === null
									? "cost unavailable"
									: review.cost.reportedDollars > 0 && review.cost.reportedDollars < 0.01
										? "<$0.01"
										: `$${review.cost.reportedDollars.toFixed(2)}`}{" "}
								({review.cost.reportedAttempts}/{review.cost.totalAttempts} reported)
							</span>
							<small>
								{review.ownerName} · {review.id}
							</small>
						</button>
					))}
					{queue?.total === 0 && <p>No captured reviews in this directory.</p>}
					<nav>
						<button type="button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - limit))}>
							Previous
						</button>
						<span>{queue?.total ?? "-"} reviews</span>
						<button
							type="button"
							disabled={queue?.page?.nextOffset == null}
							onClick={() => setOffset(queue!.page!.nextOffset!)}
						>
							Next
						</button>
					</nav>
				</aside>
				<main aria-label="Review evidence">
					{current ? (
						<>
							<header>
								<select
									aria-label="Review evidence view"
									value={part}
									onChange={(event) => {
										setPart(event.target.value as Part);
										setDetailOffset(0);
									}}
								>
									{parts.map((part) => (
										<option key={part}>{part}</option>
									))}
								</select>
								<button
									type="button"
									disabled={busy}
									onClick={() => {
										void api
											.signOff({ review: current.id })
											.then(() => setError(""))
											.catch((error) => setError(errorText(error)));
									}}
								>
									Open captured sign-off
								</button>
								{["failed", "incomplete", "interrupted"].includes(current.state) && (
									<button type="button" disabled={busy || !!pending} onClick={() => action("resume", current)}>
										Resume
									</button>
								)}
								{["running", "queued", "capturing", "interrupted", "failed", "incomplete"].includes(current.state) && (
									<button type="button" disabled={busy || !!pending} onClick={() => action("cancel", current)}>
										Cancel
									</button>
								)}
							</header>
							<p className="wp-reviews-identity">
								{current.id} · assessment {current.revision} · {current.digest}
							</p>
							{part === "source" && (
								<form onSubmit={(event) => event.preventDefault()}>
									<select
										aria-label="Captured side"
										value={side}
										onChange={(event) => {
											setSide(event.target.value as typeof side);
											setDetailOffset(0);
										}}
									>
										<option>after</option>
										<option>before</option>
									</select>
									<input
										aria-label="Captured file path"
										placeholder="Blank lists captured files"
										value={path}
										onChange={(event) => {
											setPath(event.target.value);
											setDetailOffset(0);
										}}
									/>
									<button type="button" onClick={() => refresh((n) => n + 1)}>
										Read
									</button>
								</form>
							)}
							{part === "source" && detail ? (
								<SourceView
									source={detail as ReviewSource}
									onOpen={(path) => {
										setPath(path);
										setDetailOffset(0);
									}}
								/>
							) : (
								<EvidenceView part={part} data={detail} />
							)}
							<nav>
								<button
									type="button"
									disabled={!detailOffset}
									onClick={() => setDetailOffset(Math.max(0, detailOffset - limit))}
								>
									Previous evidence page
								</button>
								<button type="button" disabled={next == null} onClick={() => setDetailOffset(next!)}>
									Next evidence page
								</button>
							</nav>
							{["completed", "incomplete", "failed", "interrupted", "cancelled"].includes(current.state) && (
								<details>
									<summary>Authorize additional work</summary>
									<form
										onSubmit={(event) => {
											event.preventDefault();
											if (
												!current.digest ||
												pending ||
												!window.confirm(
													"Replan this retained target with this question? Required inspections run again and can incur model cost. Live edits are not captured.",
												)
											)
												return;
											void manage({
												attempt: crypto.randomUUID(),
												operation: {
													action: "extend",
													review: current.id,
													digest: current.digest,
													revision: current.revision,
													question,
													reason,
													doneWhen,
												},
											});
										}}
									>
										<input
											required
											aria-label="Additional review question"
											placeholder="Concrete question"
											value={question}
											onChange={(event) => setQuestion(event.target.value)}
										/>
										<input
											required
											aria-label="Reason for additional work"
											placeholder="Why more work is justified"
											value={reason}
											onChange={(event) => setReason(event.target.value)}
										/>
										<input
											required
											aria-label="Evidence that settles the question"
											placeholder="Stopping condition"
											value={doneWhen}
											onChange={(event) => setDoneWhen(event.target.value)}
										/>
										<button type="submit" disabled={busy || !!pending}>
											Authorize reviewer work
										</button>
									</form>
								</details>
							)}
						</>
					) : (
						<p>Select a review to inspect its evidence.</p>
					)}
				</main>
			</div>
		</section>
	);
}

function EvidenceView({ part, data }: { part: Part; data: unknown }) {
	if (data === undefined) return <p>Loading evidence...</p>;
	if (part === "summary") return <pre>{summaryLines(data as ReviewSummary).join("\n")}</pre>;
	if (part === "findings") {
		const findings = data as { total: number; page: { rows: ReviewAssessment["findings"] } | null };
		return (
			<>
				{findings.page?.rows.map((entry) => (
					<article key={`${entry.attempt}:${entry.id}`}>
						<pre>{findingLines(entry).join("\n")}</pre>
					</article>
				))}
				{findings.total === 0 && <p>No reported findings. This does not establish correctness.</p>}
			</>
		);
	}
	return <pre>{JSON.stringify(data, null, 2)}</pre>;
}

function SourceView({ source, onOpen }: { source: ReviewSource; onOpen(path: string): void }) {
	if (source.kind === "files")
		return (
			<ul>
				{source.page?.rows.map((file) => (
					<li key={file.path}>
						<button type="button" onClick={() => onOpen(file.path)}>
							{file.path}
						</button>
					</li>
				))}
			</ul>
		);
	return (
		<>
			<p>
				{source.side}: {source.file.path} · {source.representation}
			</p>
			<p>{source.note}</p>
			<pre>
				{source.page?.rows.map((line, index) => `${source.page!.offset + index + 1} | ${line}`).join("\n") ??
					"No text lines"}
			</pre>
		</>
	);
}

function ReviewCapture({
	api,
	root,
	owners,
	onQueued,
}: {
	api: ReviewsApi;
	root: string;
	owners: { id: string; name: string }[];
	onQueued(): void;
}) {
	const [kind, setKind] = useState<ReviewTarget["kind"]>("working-tree");
	const [base, setBase] = useState("HEAD");
	const [head, setHead] = useState("HEAD");
	const [owner, setOwner] = useState("");
	const [intent, setIntent] = useState("");
	const [preview, setPreview] = useState<Awaited<ReturnType<ReviewsApi["preview"]>>>();
	const [request, setRequest] = useState<ReviewRequest>();
	const [pending, setPending] = useState<Parameters<ReviewsApi["enqueue"]>[0]>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const queue = async (input: Parameters<ReviewsApi["enqueue"]>[0]) => {
		setBusy(true);
		setPending(input);
		setError("");
		try {
			await api.enqueue(input);
			onQueued();
		} catch (error) {
			setError(`${errorText(error)} This request may have applied; retry keeps its original identity.`);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="wp-review-capture">
			<h3>Capture exact code before starting reviewers</h3>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					setError("");
					setBusy(true);
					setPreview(undefined);
					const target: ReviewTarget =
						kind === "working-tree"
							? { kind, base }
							: kind === "staged"
								? { kind }
								: kind === "commit"
									? { kind, commit: head }
									: { kind, base, head };
					const request = { cwd: root, target, ...(intent.trim() ? { intent: { text: intent } } : {}) };
					setRequest(request);
					void api
						.preview(request)
						.then(setPreview)
						.catch((error) => setError(errorText(error)))
						.finally(() => setBusy(false));
				}}
			>
				<fieldset disabled={busy || !!pending}>
					<legend>{root || "Select a repository first"}</legend>
					<label>
						Target{" "}
						<select
							value={kind}
							onChange={(event) => {
								setKind(event.target.value as typeof kind);
								setPreview(undefined);
							}}
						>
							{["working-tree", "staged", "commit", "range", "branch"].map((kind) => (
								<option key={kind}>{kind}</option>
							))}
						</select>
					</label>
					<label>
						Base{" "}
						<input
							value={base}
							onChange={(event) => {
								setBase(event.target.value);
								setPreview(undefined);
							}}
						/>
					</label>
					<label>
						Head / commit{" "}
						<input
							value={head}
							onChange={(event) => {
								setHead(event.target.value);
								setPreview(undefined);
							}}
						/>
					</label>
					<label>
						Lasting owner ID{" "}
						<input
							required
							list="wp-review-owners"
							value={owner}
							onChange={(event) => {
								setOwner(event.target.value);
								setPreview(undefined);
							}}
						/>
					</label>
					<label>
						<datalist id="wp-review-owners">
							{owners.map((owner) => (
								<option key={owner.id} value={owner.id} label={owner.name} />
							))}
						</datalist>
						Approved intent (optional){" "}
						<textarea
							value={intent}
							onChange={(event) => {
								setIntent(event.target.value);
								setPreview(undefined);
							}}
						/>
					</label>
					<button type="submit" disabled={!root}>
						Preview without reviewers
					</button>
				</fieldset>
			</form>
			{error && <p role="alert">{error}</p>}
			{preview && (
				<>
					<pre>{preview.lines.join("\n")}</pre>
					<p>
						Independent model usage can incur cost. Admission captures again and refuses changed identity. Empty
						comparisons do not start reviewers.
					</p>
					<button
						type="button"
						disabled={busy || !!pending || !preview.changedPaths}
						onClick={() =>
							request && void queue({ attempt: crypto.randomUUID(), request, expectedDigest: preview.digest, owner })
						}
					>
						Queue this captured identity
					</button>
				</>
			)}
			{pending && (
				<button type="button" disabled={busy} onClick={() => void queue(pending)}>
					Retry original capture request
				</button>
			)}
		</section>
	);
}

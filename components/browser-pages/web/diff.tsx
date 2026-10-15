import type { MouseEvent } from "react";

import type { CommentKind, Decision, Hunk as HunkData, Note as NoteData } from "../src/page-data";
import { useReview } from "./context";
import { anchorLabel, ATT_LABEL, hunkRange } from "./model";
import { isOpen, markPatternSeen, saveComposer, type State } from "./state";
import { baseName, CodeLine, Diamond, dirName, Icon, Kbd, Md, plural } from "./ui";

export const COMMENT_KINDS: Record<CommentKind, string> = {
	change: "Change",
	question: "Question",
	concern: "Concern",
	nit: "Nit",
	praise: "Praise",
};
const PLACEHOLDER: Record<CommentKind, string> = {
	change: "What should change?",
	question: "What would you like to know?",
	concern: "What worries you?",
	nit: "A small thing…",
	praise: "What is good here?",
};
/** Hunks longer than this start folded to their first FOLD_SHOW lines. */
const FOLD_AT = 80;
const FOLD_SHOW = 40;

function Comment({ comment }: { comment: State["comments"][number] }) {
	const { m, update, readOnly } = useReview();
	return (
		<div className={`cmt k-${comment.kind} ${comment.replyTo ? "" : "inl"}`} id={`cmt-${comment.id}`}>
			<div className="cmt-h">
				<span className="av">You</span>
				<span className="kind">{COMMENT_KINDS[comment.kind]}</span>
				{comment.replyTo ? null : (
					<span className="where">{anchorLabel(m.page, comment.hunk, comment.start, comment.end)}</span>
				)}
				<span className="sp" />
				{readOnly ? null : (
					<button
						type="button"
						className="link"
						onClick={() =>
							update((s) => {
								s.comments = s.comments.filter((c) => c.id !== comment.id);
							})
						}
					>
						Delete
					</button>
				)}
			</div>
			<Md as="div" text={comment.text} />
		</div>
	);
}

export function Composer() {
	const { m, s, update } = useReview();
	const c = s.composer;
	if (!c) return null;
	const set = (change: (draft: NonNullable<State["composer"]>) => void) =>
		update((draft) => {
			if (draft.composer) change(draft.composer);
		});
	return (
		<div className={`composer ${c.replyTo ? "" : "inl"}`}>
			<div className="composer-top">
				{c.replyTo ? (
					<span>Reply to the agent</span>
				) : (
					<>
						<span>
							Comment on <b>{anchorLabel(m.page, c.hunk, c.start, c.end)}</b>
						</span>
						<span className="kbd-hint">Shift-click a line number to extend</span>
					</>
				)}
			</div>
			<div className="kinds">
				{(Object.keys(COMMENT_KINDS) as CommentKind[]).map((k) => (
					<button
						type="button"
						key={k}
						className={`kind-chip k-${k} ${c.kind === k ? "on" : ""}`}
						onClick={() =>
							set((draft) => {
								draft.kind = k;
							})
						}
					>
						{COMMENT_KINDS[k]}
					</button>
				))}
			</div>
			<textarea
				id="composer-text"
				// biome-ignore lint/a11y/noAutofocus: the composer opens because the reviewer asked to write.
				autoFocus
				rows={3}
				placeholder={PLACEHOLDER[c.kind]}
				value={c.text}
				onChange={(e) => {
					const value = e.target.value;
					set((draft) => {
						draft.text = value;
					});
				}}
			/>
			<div className="composer-foot">
				<span className="kbd-hint">
					<Kbd>⌘</Kbd>
					<Kbd>↵</Kbd> save · <Kbd>esc</Kbd> cancel
				</span>
				<span className="sp" />
				<button
					type="button"
					className="btn ghost"
					onClick={() =>
						update((draft) => {
							draft.composer = null;
						})
					}
				>
					Cancel
				</button>
				<button type="button" className="btn primary" onClick={() => update(saveComposer)}>
					Comment
				</button>
			</div>
		</div>
	);
}

function Note({ note }: { note: NoteData }) {
	const { s, update, readOnly } = useReview();
	const replies = s.comments.filter((c) => c.replyTo === note.id);
	const replying = s.composer?.replyTo === note.id;
	const open = s.notesAll || s.noteOpen[note.id] || replying || replies.length > 0;
	const toggle = () =>
		update((d) => {
			d.noteOpen[note.id] = !d.noteOpen[note.id];
		});
	if (!open)
		return (
			<button type="button" className="note-c inl" onClick={toggle}>
				<Icon.spark />
				<Md className="note-c-t" text={note.text} />
				<span className="note-c-more">More</span>
			</button>
		);
	return (
		<div className="note inl">
			<div className="note-h">
				<Icon.spark />
				<span className="who">Agent</span>
				<span>· note on {note.label}</span>
			</div>
			<Md as="div" text={note.text} />
			{replies.length || replying ? (
				<div className="replies">
					{replies.map((c) => (
						<Comment key={c.id} comment={c} />
					))}
					{replying ? <Composer /> : null}
				</div>
			) : null}
			{replying ? null : (
				<div className="note-actions">
					{readOnly ? null : (
						<button
							type="button"
							className="link"
							onClick={() =>
								update((d) => {
									d.composer = {
										hunk: note.hunk,
										anchor: note.idx,
										start: note.idx,
										end: note.idx,
										kind: "question",
										text: "",
										replyTo: note.id,
									};
								})
							}
						>
							Reply
						</button>
					)}
					{s.notesAll ? null : (
						<button type="button" className="link" onClick={toggle}>
							Collapse
						</button>
					)}
				</div>
			)}
		</div>
	);
}

export function answerText(s: State, d: Decision) {
	const answer = s.decisions[d.id];
	if (answer) return { who: "You chose", label: d.options[answer.choice]?.label ?? "" };
	if (d.chosen === undefined) return { who: "Needs your answer", label: "" };
	return { who: "Agent chose", label: d.options[d.chosen].label };
}

export function DecisionCard({ decision }: { decision: Decision }) {
	const { s, update, readOnly } = useReview();
	const answer = s.decisions[decision.id];
	const open = decision.chosen === undefined;
	return (
		<div className={`decision ${open ? "open" : ""}`}>
			<div className="dec-h">
				{open ? <Icon.question /> : <Diamond />}
				<span>{open ? "Question for you" : "Judgment call"}</span>
				<button
					type="button"
					className="link"
					onClick={() =>
						update((d) => {
							d.decOpen[decision.id] = false;
						})
					}
				>
					Collapse
				</button>
			</div>
			<Md as="div" className="dec-q" text={decision.question} />
			{decision.context ? <Md as="p" className="dec-ctx" text={decision.context} /> : null}
			<div className="dec-opts">
				{decision.options.map((o, i) => (
					<button
						type="button"
						// biome-ignore lint/suspicious/noArrayIndexKey: options are addressed by index in the result.
						key={i}
						disabled={readOnly}
						className={`dec-opt ${answer?.choice === i ? "on" : ""}`}
						onClick={() =>
							update((d) => {
								d.decisions[decision.id] = { ...d.decisions[decision.id], choice: i };
							})
						}
					>
						<span className="radio" />
						<span className="dec-body">
							<span className="dec-label">
								<Md text={o.label} />
								{decision.chosen === i ? <span className="tag-agent">Agent's choice</span> : null}
							</span>
							{o.detail ? <Md className="dec-detail" text={o.detail} /> : null}
						</span>
					</button>
				))}
			</div>
			{answer ? (
				<textarea
					className="dec-note"
					rows={2}
					readOnly={readOnly}
					placeholder="Add a note for the agent (optional)"
					value={answer.note ?? ""}
					onChange={(e) => {
						const value = e.target.value;
						update((d) => {
							const entry = d.decisions[decision.id];
							if (entry) entry.note = value;
						});
					}}
				/>
			) : null}
		</div>
	);
}

function DecisionInline({ decision }: { decision: Decision }) {
	const { s, update } = useReview();
	if (s.decOpen[decision.id])
		return (
			<div className="inl" id={`dec-${decision.id}`}>
				<DecisionCard decision={decision} />
			</div>
		);
	const open = decision.chosen === undefined;
	const { who, label } = answerText(s, decision);
	return (
		<button
			type="button"
			id={`dec-${decision.id}`}
			className={`dec-c inl ${open ? "q" : ""}`}
			onClick={() =>
				update((d) => {
					d.decOpen[decision.id] = true;
				})
			}
		>
			{open ? (
				<span className="di">
					<Icon.question />
				</span>
			) : (
				<Diamond />
			)}
			<span className="dec-c-k">{open ? "Question" : "Judgment call"}</span>
			<Md className="dec-c-t" text={decision.question} />
			<span className="dec-c-a">
				{who} {label ? <Md as="span" className="b" text={label} /> : null}
			</span>
		</button>
	);
}

function Rows({ hunk }: { hunk: HunkData }) {
	const { m, s, update, readOnly } = useReview();
	const c = s.composer;
	const lineComposer = c && !c.replyTo && c.hunk === hunk.id ? c : null;
	const folded = hunk.lines.length > FOLD_AT && !s.unfold[hunk.id];
	const lines = folded ? hunk.lines.slice(0, FOLD_SHOW) : hunk.lines;
	const notes = m.notesIn[hunk.id] ?? [];
	const decisions = m.decisionsIn[hunk.id] ?? [];
	const comments = s.comments.filter((x) => !x.replyTo && x.hunk === hunk.id);
	const clickLine = (i: number) => (e: MouseEvent) => {
		if (readOnly) return;
		const shift = e.shiftKey;
		update((d) => {
			const current = d.composer;
			if (current && !current.replyTo && current.hunk === hunk.id && shift) {
				current.start = Math.min(current.anchor, i);
				current.end = Math.max(current.anchor, i);
			} else d.composer = { hunk: hunk.id, anchor: i, start: i, end: i, kind: "change", text: "" };
			d.focus = hunk.id;
		});
	};
	if (hunk.lines.length === 0) return <div className="hunk-note">{hunk.note ?? "No text changes"}</div>;
	return (
		<>
			{lines.map((l, i) => {
				const selected = lineComposer && i >= lineComposer.start && i <= lineComposer.end;
				const commented = comments.some((x) => i >= x.start && i <= x.end);
				const cls = `dl ${l.t === "+" ? "add" : l.t === "-" ? "del" : ""} ${selected ? "sel" : commented ? "has-c" : ""}`;
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: a hunk's lines are fixed; the index is the line's identity.
					<div key={i}>
						<div className={cls}>
							<button type="button" className="g" tabIndex={-1} onClick={clickLine(i)}>
								<span>{l.o ?? ""}</span>
								<span>{l.n ?? ""}</span>
							</button>
							<span className="sg">{l.t === "-" ? "−" : l.t === "+" ? "+" : ""}</span>
							<code>
								<CodeLine segments={l.s} />
							</code>
						</div>
						{decisions
							.filter((d) => d.idx === i)
							.map((d) => (
								<DecisionInline key={d.id} decision={d} />
							))}
						{notes
							.filter((n) => n.idx === i)
							.map((n) => (
								<Note key={n.id} note={n} />
							))}
						{comments
							.filter((x) => x.end === i)
							.map((x) => (
								<Comment key={x.id} comment={x} />
							))}
						{lineComposer && lineComposer.end === i ? <Composer /> : null}
					</div>
				);
			})}
			{folded ? (
				<button
					type="button"
					className="fold"
					onClick={() =>
						update((d) => {
							d.unfold[hunk.id] = true;
						})
					}
				>
					Show {hunk.lines.length - FOLD_SHOW} more lines{m.isGenerated(hunk.id) ? " of generated code" : ""}
				</button>
			) : null}
		</>
	);
}

export function HunkView({ id, force }: { id: string; force?: boolean }) {
	const { m, s, update } = useReview();
	const hunk = m.page.hunks[id];
	const open = force || isOpen(m, s, id);
	const seen = !!s.seen[id];
	const notes = (m.notesIn[id] ?? []).length;
	const decisions = (m.decisionsIn[id] ?? []).length;
	const comments = s.comments.filter((c) => c.hunk === id).length;
	const toggle = () =>
		update((d) => {
			d.open[id] = !isOpen(m, d, id);
			d.focus = id;
		});
	return (
		<div
			className={`hunk ${open ? "open" : ""} ${seen ? "seen" : ""} ${id === s.focus ? "focus" : ""}`}
			id={`hunk-${id}`}
		>
			<div className="hunk-h">
				{force ? null : (
					<button type="button" className="hk-chev" title="Collapse (X)" onClick={toggle}>
						{Icon.chevron(!open)}
					</button>
				)}
				<button
					type="button"
					className={`hk-seen ${seen ? "on" : ""}`}
					title="Looks good (↵)"
					onClick={() =>
						update((d) => {
							d.seen[id] = !d.seen[id];
							delete d.open[id];
							d.focus = id;
						})
					}
				>
					<Icon.check />
				</button>
				<button type="button" className="hk-sum" disabled={force} onClick={toggle}>
					{m.patternOf[id] ? (
						<>
							<span className="inst">
								{dirName(hunk.file)}
								<b>{baseName(hunk.file)}</b>
							</span>
							{m.differs(id) ? (
								<span className="tag-diff">
									<Icon.warn /> More than a rename of the example
								</span>
							) : null}
						</>
					) : m.chapterOf[id] ? (
						<Md text={m.summaryOf(id)} />
					) : (
						<span className="un">Not explained by the agent</span>
					)}
				</button>
				<span className="hk-meta">
					{m.isGenerated(id) ? <span className="tag-gen">Generated</span> : null}
					{decisions ? <span className="m dec">◆{decisions}</span> : null}
					{notes ? (
						<span className="m agent">
							<Icon.spark />
							{notes}
						</span>
					) : null}
					{comments ? (
						<span className="m">
							<Icon.bubble />
							{comments}
						</span>
					) : null}
					<span className={`att-dot att-${m.attOf(id)}`} title={ATT_LABEL[m.attOf(id)]} />
					<span className="hr">{hunkRange(m.page, id)}</span>
					<span className="n-add">+{hunk.adds}</span>
					<span className="n-del">−{hunk.dels}</span>
				</span>
			</div>
			{open ? (
				<div className="hunk-b">
					<Rows hunk={hunk} />
				</div>
			) : null}
		</div>
	);
}

const STATUS_LABEL = { A: "New", D: "Deleted", M: "Edited", R: "Renamed", G: "Generated" } as const;

function FileCard({ file, ids, pageKey, force }: { file: string; ids: string[]; pageKey: string; force?: boolean }) {
	const { m, s, update } = useReview();
	const info = m.page.files.find((f) => f.path === file)!;
	const key = `${pageKey}|${file}`;
	const closed = !force && !!s.fileClosed[key];
	const seen = ids.filter((id) => s.seen[id]).length;
	const status = info.generated ? "G" : info.status;
	return (
		<section className={`file ${info.status === "A" ? "new" : ""} ${closed ? "closed" : ""}`}>
			<header className="file-h">
				<button
					type="button"
					className="file-toggle"
					disabled={force}
					onClick={() =>
						update((d) => {
							d.fileClosed[key] = !closed;
						})
					}
				>
					{force ? null : Icon.chevron(closed)}
					<span className={`st st-${status}`}>{STATUS_LABEL[status]}</span>
					<span className="path">
						{info.oldPath ? <span className="old">{info.oldPath} → </span> : null}
						{dirName(file)}
						<b>{baseName(file)}</b>
					</span>
				</button>
				<span className="sp" />
				{ids.length > 1 ? (
					<span className="file-seen">
						{seen}/{ids.length} seen
					</span>
				) : null}
				<span className="n-add">+{ids.reduce((a, id) => a + m.page.hunks[id].adds, 0)}</span>
				<span className="n-del">−{ids.reduce((a, id) => a + m.page.hunks[id].dels, 0)}</span>
			</header>
			{closed ? null : ids.map((id) => <HunkView key={id} id={id} force={force} />)}
		</section>
	);
}

function PatternCard({ pid, force }: { pid: string; force?: boolean }) {
	const { m, s, update, readOnly } = useReview();
	const pattern = m.page.patterns[pid];
	const [example, ...rest] = pattern.hunks;
	const key = `pat|${pid}`;
	const closed = !force && !!s.fileClosed[key];
	const seen = pattern.hunks.filter((id) => s.seen[id]).length;
	const differs = pattern.differs.length;
	return (
		<section className={`file pattern ${closed ? "closed" : ""}`}>
			<header className="file-h">
				<button
					type="button"
					className="file-toggle"
					disabled={force}
					onClick={() =>
						update((d) => {
							d.fileClosed[key] = !closed;
						})
					}
				>
					{force ? null : Icon.chevron(closed)}
					<span className="st st-P">Repeated ×{pattern.hunks.length}</span>
					<Md className="pat-t" text={pattern.summary} />
				</button>
				{differs ? (
					<span className="tag-diff">
						<Icon.warn /> {differs} not a rename
					</span>
				) : null}
				<span className="file-seen">
					{seen}/{pattern.hunks.length} seen
				</span>
				{readOnly ? null : (
					<button type="button" className="btn sm" onClick={() => update((d) => markPatternSeen(m, d, pid))}>
						<Icon.check /> Mark all seen <Kbd>⇧↵</Kbd>
					</button>
				)}
			</header>
			{closed ? null : (
				<>
					<div className="pat-sub">Example</div>
					<HunkView id={example} />
					<div className="pat-sub">
						The same change in {plural(rest.length, "more place")} · a token comparison flags any place that is more
						than a rename of the example; it is a hint, not proof
						{differs ? <span className="warn"> · {differs} flagged and opened</span> : null}
					</div>
					{rest.map((id) => (
						<HunkView key={id} id={id} />
					))}
				</>
			)}
		</section>
	);
}

/** Hunks grouped for display: a repeated change as one card, everything else by file, in the given order. */
export function Units({ ids, pageKey, force }: { ids: string[]; pageKey: string; force?: boolean }) {
	const { m } = useReview();
	const units: ({ pattern: string } | { file: string; ids: string[] })[] = [];
	for (const id of ids) {
		const p = m.patternOf[id];
		if (p) {
			if (!units.some((u) => "pattern" in u && u.pattern === p)) units.push({ pattern: p });
			continue;
		}
		const file = m.page.hunks[id].file;
		const unit = units.find((u): u is { file: string; ids: string[] } => "file" in u && u.file === file);
		if (unit) unit.ids.push(id);
		else units.push({ file, ids: [id] });
	}
	return (
		<>
			{units.map((u) =>
				"pattern" in u ? (
					<PatternCard key={u.pattern} pid={u.pattern} force={force} />
				) : (
					<FileCard key={u.file} file={u.file} ids={u.ids} pageKey={pageKey} force={force} />
				),
			)}
		</>
	);
}

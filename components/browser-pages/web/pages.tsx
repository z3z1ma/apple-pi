import type { Attention, Chapter, Decision } from "../src/page-data";
import { useReview } from "./context";
import { answerText, COMMENT_KINDS, Units } from "./diff";
import { anchorLabel, ATT_LABEL, ATTENTION, hunkRange, KIND_LABEL, UNPLACED } from "./model";
import {
	chapterStep,
	focusHunk,
	goOverview,
	markPageSeen,
	nextDecision,
	openPage,
	revealComment,
	revealDecision,
	seenNext,
	setLens,
	step,
	toResult,
} from "./state";
import { AttBars, baseName, CodeLine, Diamond, dirName, Icon, Kbd, Md, pad, plain, plural } from "./ui";

const blockWidth = (lines: number, k: number, min: number) => Math.max(min, Math.round(Math.sqrt(lines) * k));

export function TopBar() {
	const { m, s, update, readOnly } = useReview();
	const seen = m.page.order.filter((id) => s.seen[id]).length;
	const open = m.page.decisions.filter((d) => d.chosen === undefined && !s.decisions[d.id]).length;
	return (
		<header className="top">
			<div className="top-id">
				<span className="logo" />
				<Md className="top-title" text={m.page.title} />
				<span className="branch">{m.page.head}</span>
			</div>
			<div className="cov" title="Every hunk, in story order. Green is seen.">
				{m.storyOrder.map((id) => {
					const h = m.page.hunks[id];
					return (
						<button
							type="button"
							key={id}
							className={`a-${m.attOf(id)} ${s.seen[id] ? "s" : ""} ${id === s.focus ? "f" : ""}`}
							style={{ flex: Math.sqrt(h.adds + h.dels + 1) }}
							onClick={() => update((d) => focusHunk(m, d, id))}
						/>
					);
				})}
			</div>
			<span className="cov-l">
				<b>{seen}</b> of {m.page.order.length} seen
			</span>
			{open && !readOnly ? (
				<button type="button" className="q-pill" onClick={() => update((d) => nextDecision(m, d, "question"))}>
					<Icon.question /> {plural(open, "open question")} <Kbd>Q</Kbd>
				</button>
			) : null}
			<button
				type="button"
				className="btn ghost"
				title="Your comments"
				onClick={() =>
					update((d) => {
						d.modal = "comments";
					})
				}
			>
				<Icon.bubble /> {s.comments.length}
			</button>
			<button
				type="button"
				className="icon-btn"
				title="Theme"
				onClick={() =>
					update((d) => {
						d.theme = d.theme === "dark" ? "light" : "dark";
					})
				}
			>
				{s.theme === "dark" ? <Icon.sun /> : <Icon.moon />}
			</button>
			<button
				type="button"
				className="icon-btn"
				title="Keyboard (?)"
				onClick={() =>
					update((d) => {
						d.modal = "keys";
					})
				}
			>
				?
			</button>
			{readOnly ? (
				<span className={`verdict-badge vd-${s.verdict}`}>{VERDICT_LABEL[s.verdict ?? "dismissed"]}</span>
			) : (
				<button
					type="button"
					className="btn primary"
					onClick={() =>
						update((d) => {
							d.modal = "verdict";
						})
					}
				>
					Finish review <Kbd>⌘↵</Kbd>
				</button>
			)}
		</header>
	);
}

function LensSwitch() {
	const { m, s, update } = useReview();
	return (
		<div className="lens">
			{(["story", "attention"] as const).map((lens) => (
				<button
					type="button"
					key={lens}
					className={s.lens === lens ? "on" : ""}
					onClick={() => update((d) => setLens(m, d, lens))}
				>
					{lens === "story" ? "Story" : "Attention"}
				</button>
			))}
		</div>
	);
}

function RailChapter({
	pid,
	num,
	title,
	sub,
	att,
}: {
	pid: string;
	num: string;
	title: string;
	sub: string;
	att: Attention;
}) {
	const { m, s, update } = useReview();
	const ids = m.pageHunks(pid);
	const seen = ids.filter((id) => s.seen[id]).length;
	const done = seen === ids.length;
	return (
		<div className={`r-ch ${s.page === pid ? "on" : ""} ${done ? "done" : ""}`}>
			<button type="button" className="r-item" onClick={() => update((d) => openPage(m, d, pid))}>
				<span className="r-n">{num}</span>
				<span className="r-t">
					<Md className="r-tt" text={title} />
					<span className="r-ts">
						{sub} · {seen}/{ids.length}
					</span>
				</span>
				<span className="r-st">{done ? <Icon.check /> : <AttBars att={att} />}</span>
			</button>
			<div className="strip">
				{ids.map((id) => {
					const h = m.page.hunks[id];
					return (
						<button
							type="button"
							key={id}
							className={`a-${m.attOf(id)} ${s.seen[id] ? "s" : ""} ${id === s.focus ? "f" : ""}`}
							style={{ width: blockWidth(h.adds + h.dels, 2.2, 5) }}
							title={plain(m.summaryOf(id))}
							onClick={() => update((d) => focusHunk(m, d, id))}
						/>
					);
				})}
			</div>
		</div>
	);
}

export function Rail() {
	const { m, s, update } = useReview();
	if (s.lens === "story")
		return (
			<nav className="rail" data-scroll="rail">
				<LensSwitch />
				<button
					type="button"
					className={`r-item solo ${s.page === "overview" ? "on" : ""}`}
					onClick={() => update(goOverview)}
				>
					<span className="r-n">00</span>
					<span className="r-t">
						<span className="r-tt">Overview</span>
						<span className="r-ts">Focus, map, attention, decisions</span>
					</span>
					<span />
				</button>
				<div className="r-k">Chapters</div>
				{m.page.chapters.map((c, i) => (
					<RailChapter
						key={c.id}
						pid={c.id}
						num={pad(i + 1)}
						title={c.title}
						sub={KIND_LABEL[c.kind]}
						att={c.attention}
					/>
				))}
				{m.unplaced.length ? (
					<RailChapter pid={UNPLACED} num="··" title="Not in the story" sub="Unexplained" att="high" />
				) : null}
			</nav>
		);
	return (
		<nav className="rail" data-scroll="rail">
			<LensSwitch />
			{ATTENTION.map((col) => {
				const units = m.attentionUnits(col.att);
				const done = (ids: string[]) => ids.every((id) => s.seen[id]);
				const closed = !!s.groupClosed[col.att];
				return (
					<div className="r-grp" key={col.att}>
						<button
							type="button"
							className="r-grp-h"
							onClick={() =>
								update((d) => {
									d.groupClosed[col.att] = !closed;
								})
							}
						>
							{Icon.chevron(closed)}
							<AttBars att={col.att} />
							<span>{col.label}</span>
							<span className="sp" />
							<span className="r-ts">
								{units.filter((u) => done(u.ids)).length}/{units.length}
							</span>
						</button>
						{closed
							? null
							: units.map((u) => {
									const pattern = u.pattern ? m.page.patterns[u.pattern] : undefined;
									const chapter = m.chapterOf[u.rep];
									return (
										<button
											type="button"
											key={u.rep}
											className={`r-hunk ${u.rep === s.focus ? "on" : ""} ${done(u.ids) ? "done" : ""}`}
											onClick={() => update((d) => focusHunk(m, d, u.rep))}
										>
											<span className="r-hk">{done(u.ids) ? <Icon.check /> : <i className="dot" />}</span>
											<span className="r-t">
												<Md className="r-hs" text={pattern ? pattern.summary : m.summaryOf(u.rep)} />
												<span className="r-ts">
													{chapter ? pad(m.chapterIndex(chapter) + 1) : "··"} ·{" "}
													{pattern ? (
														<>
															Repeated ×{pattern.hunks.length}
															{pattern.differs.length ? (
																<span className="warn"> · {pattern.differs.length} not a rename</span>
															) : null}
														</>
													) : (
														`${baseName(m.page.hunks[u.rep].file)} ${hunkRange(m.page, u.rep)}`
													)}
												</span>
											</span>
										</button>
									);
								})}
					</div>
				);
			})}
		</nav>
	);
}

function Verification() {
	const { m } = useReview();
	if (m.page.verification.length === 0) return <p className="empty-note">The agent listed no checks.</p>;
	return (
		<ul className="verif">
			{m.page.verification.map((v, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for the page's lifetime.
				<li key={i} className={`v-${v.status}`}>
					<span className="v-ic">
						{v.status === "pass" ? <Icon.check /> : v.status === "fail" ? <Icon.x /> : <Icon.circle />}
					</span>
					<span>
						<Md className="v-l" text={v.label} />
						{v.detail ? <Md className="v-d" text={v.detail} /> : null}
					</span>
				</li>
			))}
		</ul>
	);
}

function HunkCard({ id }: { id: string }) {
	const { m, s, update } = useReview();
	const h = m.page.hunks[id];
	const chapter = m.chapterOf[id];
	const preview =
		m.attOf(id) === "high" ? h.lines.filter((l) => l.t !== " " && l.s.some((seg) => seg.t.trim())).slice(0, 3) : [];
	const notes = (m.notesIn[id] ?? []).length;
	const comments = s.comments.filter((c) => c.hunk === id).length;
	return (
		<button
			type="button"
			className={`tcard ${s.seen[id] ? "s" : ""} ${chapter ? "" : "un"}`}
			onClick={() => update((d) => focusHunk(m, d, id))}
		>
			<div className="tc-top">
				{chapter ? (
					<span className="tc-ch">
						{pad(m.chapterIndex(chapter) + 1)} · {plain(chapter.title)}
					</span>
				) : (
					<span className="tag-un">Not explained by the agent</span>
				)}
				<span className="sp" />
				{s.seen[id] ? (
					<span className="seen-ic">
						<Icon.check />
					</span>
				) : null}
			</div>
			<Md as="div" className="tc-sum" text={chapter ? m.summaryOf(id) : "A change outside every chapter."} />
			{preview.length ? (
				<div className="mini-code">
					{preview.map((l, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: preview lines are fixed.
						<div key={i} className={`mini ${l.t === "+" ? "add" : "del"}`}>
							<span>{l.t === "+" ? "+" : "−"}</span>
							<code>
								<CodeLine segments={l.s} />
							</code>
						</div>
					))}
				</div>
			) : null}
			<div className="tc-meta">
				<span className="path">{baseName(h.file)}</span>
				<span>{hunkRange(m.page, id)}</span>
				<span className="sp" />
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
				<span className="n-add">+{h.adds}</span>
				<span className="n-del">−{h.dels}</span>
			</div>
		</button>
	);
}

function PatternTile({ pid }: { pid: string }) {
	const { m, s, update } = useReview();
	const pattern = m.page.patterns[pid];
	const chapter = m.chapterOf[pattern.hunks[0]];
	const seen = pattern.hunks.filter((id) => s.seen[id]).length;
	const all = seen === pattern.hunks.length;
	return (
		<button
			type="button"
			className={`tcard pat ${all ? "s" : ""}`}
			onClick={() => update((d) => focusHunk(m, d, pattern.hunks[0]))}
		>
			<div className="tc-top">
				<span className="tc-ch">
					{pad(m.chapterIndex(chapter) + 1)} · {plain(chapter.title)}
				</span>
				<span className="sp" />
				{all ? (
					<span className="seen-ic">
						<Icon.check />
					</span>
				) : null}
			</div>
			<Md as="div" className="tc-sum" text={pattern.summary} />
			<div className="pat-dots">
				{pattern.hunks.map((id) => (
					<i key={id} className={`${s.seen[id] ? "s" : ""} ${pattern.differs.includes(id) ? "d" : ""}`} />
				))}
			</div>
			<div className="tc-meta">
				<span className="st st-P">Repeated ×{pattern.hunks.length}</span>
				{pattern.differs.length ? (
					<span className="tag-diff">
						<Icon.warn /> {pattern.differs.length} not a rename
					</span>
				) : null}
				<span className="sp" />
				<span>
					{seen}/{pattern.hunks.length} seen
				</span>
			</div>
		</button>
	);
}

function ChangeMap() {
	const { m, s, update } = useReview();
	const dirs: { dir: string; files: string[] }[] = [];
	for (const f of m.page.files) {
		const dir = dirName(f.path);
		const entry = dirs.find((d) => d.dir === dir);
		if (entry) entry.files.push(f.path);
		else dirs.push({ dir, files: [f.path] });
	}
	return (
		<section className="card map">
			<div className="card-h">
				<h2>Where the change is</h2>
				<span>One row per directory, one block per hunk, sized by lines changed</span>
				<span className="sp" />
				<div className="legend">
					<span>
						<i className="a-high" />
						Read closely
					</span>
					<span>
						<i className="a-medium" />
						Worth a look
					</span>
					<span>
						<i className="a-low" />
						Skim
					</span>
					<span>
						<i className="a-high dashed" />
						Unexplained
					</span>
				</div>
			</div>
			{dirs.map((d) => {
				const ids = m.page.order.filter((id) => dirName(m.page.hunks[id].file) === d.dir);
				return (
					<div className="map-row" key={d.dir}>
						<span className="map-dir" title={d.dir || "./"}>
							{d.dir || "./"}
						</span>
						<div className="map-files">
							{d.files.map((file) => (
								<span className="map-cl" key={file}>
									<span className="map-blocks">
										{m.page.order
											.filter((id) => m.page.hunks[id].file === file)
											.map((id) => {
												const h = m.page.hunks[id];
												return (
													<button
														type="button"
														key={id}
														className={`map-b a-${m.attOf(id)} ${s.seen[id] ? "s" : ""} ${m.chapterOf[id] ? "" : "un"} ${m.differs(id) ? "d" : ""}`}
														style={{ width: blockWidth(h.adds + h.dels, 5, 12) }}
														title={`${file} · ${plain(m.summaryOf(id))}`}
														onClick={() => update((draft) => focusHunk(m, draft, id))}
													/>
												);
											})}
									</span>
									<span className="map-name">{baseName(file)}</span>
								</span>
							))}
						</div>
						<span className="map-n">
							<span className="n-add">+{ids.reduce((a, id) => a + m.page.hunks[id].adds, 0)}</span>
							<span className="n-del">−{ids.reduce((a, id) => a + m.page.hunks[id].dels, 0)}</span>
						</span>
					</div>
				);
			})}
		</section>
	);
}

function DecisionRow({ decision }: { decision: Decision }) {
	const { m, s, update } = useReview();
	const open = decision.chosen === undefined;
	const { who, label } = answerText(s, decision);
	return (
		<div className={`dec-row ${open ? "open" : ""}`}>
			{open ? (
				<span className="di">
					<Icon.question />
				</span>
			) : (
				<Diamond />
			)}
			<div>
				<Md as="div" className="dec-row-q" text={decision.question} />
				<div className="dec-row-a">
					{who} {label ? <Md className="b" text={label} /> : null} · {baseName(m.page.hunks[decision.hunk].file)}{" "}
					{decision.label}
				</div>
			</div>
			<button type="button" className="btn ghost sm" onClick={() => update((d) => revealDecision(m, d, decision.id))}>
				Show in code <Icon.arrowR />
			</button>
		</div>
	);
}

export function Overview() {
	const { m, s, update } = useReview();
	const page = m.page;
	const adds = page.order.reduce((a, id) => a + page.hunks[id].adds, 0);
	const dels = page.order.reduce((a, id) => a + page.hunks[id].dels, 0);
	const minutes = Math.max(2, Math.round((adds + dels) / 22));
	const seen = page.order.filter((id) => s.seen[id]).length;
	return (
		<div className="ov">
			<div className="eyebrow">
				<span className="branch">{page.head}</span>
				{page.base === "HEAD" ? (
					<span>uncommitted changes</span>
				) : (
					<>
						<span>compared with</span>
						<span className="branch">{page.base}</span>
					</>
				)}
				<span>
					· {plural(page.files.length, "file")} · {plural(page.order.length, "hunk")} ·
				</span>
				<span className="n-add">+{adds}</span>
				<span className="n-del">−{dels}</span>
				<span>· about {minutes} min</span>
			</div>
			<h1 className="ov-title">
				<Md text={page.title} />
			</h1>
			<Md as="p" className="ov-intent" text={page.intent} />
			{page.warnings.length ? (
				<section className="card warnings">
					<div className="card-k">
						<Icon.warn /> The agent's references had problems
					</div>
					<ul>
						{page.warnings.map((w) => (
							<li key={w}>
								<Md text={w} />
							</li>
						))}
					</ul>
				</section>
			) : null}
			<div className="ov-grid">
				<section className="card focus">
					<div className="card-k">
						<Icon.spark /> If you only have two minutes
					</div>
					{page.focus ? (
						<Md as="p" className="focus-text" text={page.focus.text} />
					) : (
						<p className="focus-text">The agent named no starting point.</p>
					)}
					<div className="focus-list">
						{(page.focus?.hunks ?? []).map((id) => (
							<button type="button" className="focus-i" key={id} onClick={() => update((d) => focusHunk(m, d, id))}>
								<span className={`att-dot att-${m.attOf(id)}`} />
								<Md className="fi-s" text={m.summaryOf(id)} />
								<span className="fi-m">
									{baseName(page.hunks[id].file)} {hunkRange(page, id)}
								</span>
								<Icon.arrowR />
							</button>
						))}
					</div>
				</section>
				<section className="card">
					<div className="card-k">Verification</div>
					<Verification />
				</section>
			</div>
			<ChangeMap />
			<div className="sec-h">
				<h2>Changes by attention</h2>
				<span>
					{plural(page.order.length, "hunk")} · {seen} seen
				</span>
			</div>
			<div className="board">
				{ATTENTION.map((col) => {
					const units = m.attentionUnits(col.att);
					const shown = s.boardAll[col.att] ? units : units.slice(0, 5);
					const hunks = units.reduce((a, u) => a + u.ids.length, 0);
					return (
						<div className="col" key={col.att}>
							<div className="col-h">
								<AttBars att={col.att} />
								<h3>{col.label}</h3>
								<span className="count">{plural(hunks, "hunk")}</span>
							</div>
							<p className="col-d">{col.detail}</p>
							{shown.map((u) =>
								u.pattern ? <PatternTile key={u.rep} pid={u.pattern} /> : <HunkCard key={u.rep} id={u.rep} />,
							)}
							{units.length > shown.length ? (
								<button
									type="button"
									className="btn ghost block"
									onClick={() =>
										update((d) => {
											d.boardAll[col.att] = true;
										})
									}
								>
									Show {units.length - shown.length} more
								</button>
							) : null}
						</div>
					);
				})}
			</div>
			{page.decisions.length ? (
				<>
					<div className="sec-h">
						<h2>Decisions the agent made</h2>
						<span>Each one also sits at its place in the code</span>
					</div>
					<div className="dec-list">
						{page.decisions.map((d) => (
							<DecisionRow key={d.id} decision={d} />
						))}
					</div>
				</>
			) : null}
			<div className="ov-cta">
				<button type="button" className="btn primary lg" onClick={() => update((d) => step(m, d, 1))}>
					Start with chapter 01 <Icon.arrowR />
				</button>
				<span className="kbd-hint">
					or press <Kbd>J</Kbd>
				</span>
			</div>
		</div>
	);
}

function Brief({ chapter, briefKey, defaultClosed }: { chapter: Chapter; briefKey: string; defaultClosed: boolean }) {
	const { m, s, update } = useReview();
	const closed = s.briefClosed[briefKey] ?? defaultClosed;
	const toggle = () =>
		update((d) => {
			d.briefClosed[briefKey] = !closed;
		});
	if (closed)
		return (
			<button type="button" className="brief closed" onClick={toggle}>
				<Icon.spark />
				<span className="brief-k">Brief</span>
				<span className="brief-1">{plain(chapter.brief[0] ?? "").split(/(?<=\.)\s/)[0]}</span>
				<span className="sp" />
				<span className="kbd-hint">
					Show <Kbd>B</Kbd>
				</span>
			</button>
		);
	const decisions = m.page.decisions.filter((d) => m.chapterOf[d.hunk] === chapter);
	return (
		<section className="brief">
			<div className="brief-top">
				<span className="brief-k">
					<Icon.spark /> The agent's brief
				</span>
				<span className="sp" />
				<button type="button" className="link" onClick={toggle}>
					Hide <Kbd>B</Kbd>
				</button>
			</div>
			<div className="brief-prose">
				{chapter.brief.map((p) => (
					<Md as="p" key={p} text={p} />
				))}
			</div>
			{chapter.callouts.map((c) => (
				<div className="callout" key={c.title + c.text}>
					<span className="co-ic">
						<Icon.warn />
					</span>
					<div>
						<div className="co-t">{c.title}</div>
						<Md as="div" className="co-b" text={c.text} />
					</div>
				</div>
			))}
			{decisions.length ? (
				<div className="brief-decs">
					{decisions.map((d) => (
						<button
							type="button"
							className="link"
							key={d.id}
							onClick={() => update((draft) => revealDecision(m, draft, d.id))}
						>
							{d.chosen === undefined ? <Icon.question /> : "◆"} <Md text={d.question} />
						</button>
					))}
				</div>
			) : null}
		</section>
	);
}

export function ChapterPage() {
	const { m, s, update, readOnly } = useReview();
	const pid = s.page;
	const unplaced = pid === UNPLACED;
	const chapter = m.page.chapters.find((c) => c.id === pid);
	const ids = m.pageHunks(pid);
	const seen = ids.filter((id) => s.seen[id]).length;
	const files = new Set(ids.map((id) => m.page.hunks[id].file)).size;
	return (
		<div className="ch">
			<div className="ch-h">
				<div className="ch-num">
					{unplaced || !chapter ? "··" : pad(m.chapterIndex(chapter) + 1)}
					<span>/ {pad(m.page.chapters.length)}</span>
				</div>
				<div>
					<div className="ch-chips">
						{chapter ? (
							<>
								<span>{KIND_LABEL[chapter.kind]}</span>
								<span className={`att-pill att-${chapter.attention}`}>{ATT_LABEL[chapter.attention]}</span>
							</>
						) : (
							<span className="att-pill att-high">Not explained by the agent</span>
						)}
					</div>
					<h1>{chapter ? <Md text={chapter.title} /> : "Changes the agent did not explain"}</h1>
				</div>
			</div>
			{chapter ? (
				<Brief chapter={chapter} briefKey={`c:${pid}`} defaultClosed={false} />
			) : (
				<div className="brief un">
					<Icon.warn />
					<p>
						These hunks are in the diff but in no chapter. The agent did not mention them. Check that each one belongs
						in this change.
					</p>
				</div>
			)}
			<div className="ch-bar">
				<span>
					<b>{files}</b> {files === 1 ? "file" : "files"} · <b>{ids.length}</b> {ids.length === 1 ? "hunk" : "hunks"} ·{" "}
					<b>{seen}</b> seen
				</span>
				<span className="sp" />
				<button
					type="button"
					className="btn ghost sm"
					onClick={() =>
						update((d) => {
							for (const id of ids) d.open[id] = true;
						})
					}
				>
					Expand all
				</button>
				<button
					type="button"
					className="btn ghost sm"
					onClick={() =>
						update((d) => {
							for (const id of ids) d.open[id] = false;
						})
					}
				>
					Collapse all <Kbd>⇧X</Kbd>
				</button>
				<button
					type="button"
					className={`btn ghost sm ${s.notesAll ? "on" : ""}`}
					onClick={() =>
						update((d) => {
							d.notesAll = !d.notesAll;
							d.noteOpen = {};
						})
					}
				>
					<Icon.spark /> Notes: {s.notesAll ? "full" : "compact"} <Kbd>N</Kbd>
				</button>
			</div>
			<Units ids={ids} pageKey={pid} />
			<div className="ch-foot">
				<button type="button" className="btn" onClick={() => update((d) => chapterStep(m, d, -1))}>
					<Icon.chevL /> Previous <Kbd>[</Kbd>
				</button>
				<span className="sp" />
				{seen === ids.length || readOnly ? (
					<button type="button" className="btn primary" onClick={() => update((d) => chapterStep(m, d, 1))}>
						Next chapter <Kbd>]</Kbd>
					</button>
				) : (
					<button type="button" className="btn primary" onClick={() => update((d) => markPageSeen(m, d))}>
						Mark all seen and continue <Kbd>R</Kbd>
					</button>
				)}
			</div>
		</div>
	);
}

export function HunkPage() {
	const { m, s, update } = useReview();
	const id = s.focus;
	if (!id) return null;
	const chapter = m.chapterOf[id];
	const att = m.attOf(id);
	const group = m.attentionUnits(att).map((u) => u.rep);
	const pattern = m.patternOf[id] ? m.page.patterns[m.patternOf[id]] : undefined;
	return (
		<div className="ch">
			<div className="hp-kick">
				<AttBars att={att} />
				<span>{ATT_LABEL[att]}</span>
				<span className="dim">
					{group.indexOf(id) + 1} of {group.length}
				</span>
				{pattern ? <span className="st st-P">Repeated ×{pattern.hunks.length}</span> : null}
				<span className="sp" />
				{chapter ? (
					<button
						type="button"
						className="link"
						onClick={() =>
							update((d) => {
								d.lens = "story";
								focusHunk(m, d, id, { top: true });
							})
						}
					>
						{pad(m.chapterIndex(chapter) + 1)} · {plain(chapter.title)} <Icon.arrowR />
					</button>
				) : null}
			</div>
			<h1 className="hp-title">
				<Md text={pattern ? pattern.summary : chapter ? m.summaryOf(id) : "A change outside every chapter"} />
			</h1>
			{chapter ? (
				<Brief chapter={chapter} briefKey={`h:${chapter.id}`} defaultClosed />
			) : (
				<div className="brief un">
					<Icon.warn />
					<p>This hunk is in the diff but in no chapter. Check that it belongs in this change.</p>
				</div>
			)}
			<Units ids={[id]} pageKey="hunk" force />
			<div className="ch-foot">
				<button type="button" className="btn" onClick={() => update((d) => step(m, d, -1))}>
					<Icon.chevL /> Previous <Kbd>K</Kbd>
				</button>
				<span className="sp" />
				<button type="button" className="btn primary" onClick={() => update((d) => seenNext(m, d))}>
					<Icon.check /> {pattern ? `All ${pattern.hunks.length} seen` : "Looks good"} <Kbd>↵</Kbd>
				</button>
			</div>
		</div>
	);
}

const VERDICTS = [
	{ id: "approve", label: "Approve", detail: "Ship it as it is." },
	{ id: "approve_notes", label: "Approve with notes", detail: "Ship it, and act on my comments." },
	{ id: "changes", label: "Request changes", detail: "Address my comments, then ask again." },
] as const;
export const VERDICT_LABEL: Record<string, string> = {
	approve: "Approved",
	approve_notes: "Approved with notes",
	changes: "Changes requested",
	dismissed: "Closed without a verdict",
};

export async function submitReview(token: string, body: unknown): Promise<boolean> {
	try {
		const response = await fetch("/result", {
			method: "POST",
			headers: { "content-type": "application/json", "x-page-token": token },
			body: JSON.stringify(body),
		});
		return response.ok;
	} catch {
		return false;
	}
}

function VerdictPanel({
	onSubmit,
}: {
	onSubmit: (verdict: "approve" | "approve_notes" | "changes" | "dismissed") => void;
}) {
	const { m, s, update } = useReview();
	const seen = m.page.order.filter((id) => s.seen[id]).length;
	const answered = m.page.decisions.filter((d) => s.decisions[d.id]).length;
	const open = m.page.decisions.filter((d) => d.chosen === undefined && !s.decisions[d.id]).length;
	return (
		<div className="verdict">
			<div className="vd-stats">
				<span>
					<b>{seen}</b> of {m.page.order.length} hunks seen
				</span>
				<span>
					<b>{s.comments.length}</b> {s.comments.length === 1 ? "comment" : "comments"}
				</span>
				{m.page.decisions.length ? (
					<span>
						<b>{answered}</b> of {m.page.decisions.length} decisions answered
					</span>
				) : null}
				{open ? <span className="warn">{plural(open, "question")} still open</span> : null}
			</div>
			<div className="vd-opts">
				{VERDICTS.map((v) => (
					<button
						type="button"
						key={v.id}
						className={`vd-opt vd-${v.id} ${s.verdict === v.id ? "on" : ""}`}
						onClick={() =>
							update((d) => {
								d.verdict = v.id;
							})
						}
					>
						<span className="vd-l">{v.label}</span>
						<span className="vd-d">{v.detail}</span>
					</button>
				))}
			</div>
			<textarea
				id="summary"
				rows={3}
				placeholder="Anything else the agent should know? (optional)"
				value={s.summary}
				onChange={(e) => {
					const value = e.target.value;
					update((d) => {
						d.summary = value;
					});
				}}
			/>
			<div className="vd-foot">
				<button type="button" className="link" onClick={() => onSubmit("dismissed")}>
					Close without a verdict
				</button>
				<span className="sp" />
				{s.submit === "failed" ? (
					<span className="warn">Could not reach the agent. Is the session still open?</span>
				) : null}
				<span className="kbd-hint">
					<Kbd>⌘</Kbd>
					<Kbd>↵</Kbd> to send
				</span>
				<button
					type="button"
					className="btn primary lg"
					disabled={!s.verdict || s.submit === "sending"}
					onClick={() => s.verdict && s.verdict !== "dismissed" && onSubmit(s.verdict)}
				>
					<Icon.send /> Send to agent
				</button>
			</div>
		</div>
	);
}

const KEYS: [string, string][] = [
	["J / K", "Next / previous hunk"],
	["] / [", "Next / previous chapter"],
	["↵", "Looks good: mark seen, collapse, go to the next unseen hunk"],
	["⇧↵", "Mark every place of a repeated change seen"],
	["R", "Mark the chapter seen and continue"],
	["X", "Collapse or expand the hunk"],
	["⇧X", "Collapse or expand every hunk on the page"],
	["C", "Comment on the hunk"],
	["A", "Ask the agent about the hunk"],
	["B", "Hide or show the brief"],
	["N", "Compact or full agent notes"],
	["Space / ⇧Space", "Scroll a screen"],
	["D / U", "Scroll half a screen"],
	["L", "Switch lens: story or attention"],
	["Q", "Next open question (opens and scrolls to it)"],
	["⇧Q", "Next judgment call"],
	["O", "Overview"],
	["⌘↵", "Finish review"],
	["Esc", "Close"],
];

export function Modal({
	onSubmit,
}: {
	onSubmit: (verdict: "approve" | "approve_notes" | "changes" | "dismissed") => void;
}) {
	const { m, s, update } = useReview();
	if (!s.modal) return null;
	const close = () =>
		update((d) => {
			d.modal = null;
		});
	const heads = { verdict: "Finish review", keys: "Keyboard", comments: "Your comments" };
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Escape closes the modal.
		<div className="overlay" onClick={close}>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the panel only stops the overlay's click. */}
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<div className="modal-h">
					<h3>{heads[s.modal]}</h3>
					<span className="sp" />
					<button type="button" className="icon-btn" onClick={close}>
						<Icon.x />
					</button>
				</div>
				{s.modal === "verdict" ? <VerdictPanel onSubmit={onSubmit} /> : null}
				{s.modal === "keys" ? (
					<div className="keys">
						{KEYS.map(([k, v]) => (
							<div key={k}>
								<span>{v}</span>
								<kbd>{k}</kbd>
							</div>
						))}
					</div>
				) : null}
				{s.modal === "comments" ? (
					s.comments.length ? (
						s.comments.map((c) => (
							<button
								type="button"
								key={c.id}
								className={`cl-item k-${c.kind}`}
								onClick={() => update((d) => revealComment(m, d, c))}
							>
								<span className="cl-meta">
									<span className="kind">{COMMENT_KINDS[c.kind]}</span>
									<span>
										{baseName(m.page.hunks[c.hunk].file)} {anchorLabel(m.page, c.hunk, c.start, c.end)}
									</span>
								</span>
								<Md text={c.text} />
							</button>
						))
					) : (
						<div className="empty">No comments yet. Click a line number to add one.</div>
					)
				) : null}
			</div>
		</div>
	);
}

export { toResult };

import { memo, type ReactNode } from "react";

import type { MarkdownBlock, MarkdownLabel } from "../../src/page-data";
import { Answer, Icon, Kbd, Md } from "../ui";
import { useDocReview } from "./context";
import { renderBlock } from "./render";
import { addAnnotation, annotation, annotationTitle, LABELS, VERDICTS } from "./state";

/** Line diff of a block's source and the reviewer's rewrite. */
function SourceDiff({ before, after }: { before: string; after: string }) {
	const a = before.split("\n");
	const b = after.split("\n");
	const rows: { t: " " | "+" | "-"; s: string }[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && a[i] === b[j]) {
			rows.push({ t: " ", s: a[i++] });
			j++;
		} else if (j < b.length && !a.slice(i).includes(b[j])) rows.push({ t: "+", s: b[j++] });
		else rows.push({ t: "-", s: a[i++] });
	}
	return (
		<div className="src-diff">
			{rows.map((r, k) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional.
				<div key={k} className={r.t === "+" ? "a" : r.t === "-" ? "d" : ""}>
					{r.t === " " ? "  " : `${r.t} `}
					{r.s}
				</div>
			))}
		</div>
	);
}

/**
 * The rendered block. Memoised so React never replaces the DOM that highlights and Mermaid decorate. Text offsets
 * point into the original block, so a rewritten block has no `data-content`: it takes no new marks and draws none.
 */
const BlockContent = memo(function BlockContent({ id, html }: { id?: string; html: string }) {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: renderBlock escapes all document text and drops unsafe URLs.
	return <div className="blk-content" data-content={id} dangerouslySetInnerHTML={{ __html: html }} />;
});

function BlockEditor({ block, source }: { block: MarkdownBlock; source: string }) {
	const { update } = useDocReview();
	return (
		<div className="blk block-editor">
			<textarea id="block-src" defaultValue={source} rows={Math.max(4, source.split("\n").length + 1)} />
			<div className="row">
				<span className="kbd-hint">Your rewrite goes back to the agent as feedback; the file is not changed.</span>
				<span className="sp" />
				<button
					type="button"
					className="btn ghost"
					onClick={() =>
						update((d) => {
							d.editing = null;
						})
					}
				>
					Cancel
				</button>
				<button
					type="button"
					id="edit-save"
					className="btn primary"
					onClick={() => {
						const value = (document.getElementById("block-src") as HTMLTextAreaElement).value.replace(/\n+$/, "");
						update((d) => {
							if (value === block.raw) delete d.edits[block.id];
							else d.edits[block.id] = value;
							d.editing = null;
						});
					}}
				>
					Save rewrite
				</button>
			</div>
		</div>
	);
}

function RewriteTag({ block, after }: { block: MarkdownBlock; after: string }) {
	const { s, update, readOnly } = useDocReview();
	return (
		<>
			<div className="edit-tag">
				<Icon.pencil /> Your rewrite
				<button
					type="button"
					className="link"
					onClick={() =>
						update((d) => {
							d.diffOpen[block.id] = !d.diffOpen[block.id];
						})
					}
				>
					{s.diffOpen[block.id] ? "Hide" : "Show"} diff
				</button>
				{readOnly ? null : (
					<button
						type="button"
						className="link"
						onClick={() =>
							update((d) => {
								delete d.edits[block.id];
							})
						}
					>
						Revert
					</button>
				)}
			</div>
			{s.diffOpen[block.id] ? <SourceDiff before={block.raw} after={after} /> : null}
		</>
	);
}

export function Block({ block }: { block: MarkdownBlock }) {
	const { s, update, readOnly, openPop } = useDocReview();
	const edit = s.edits[block.id];
	if (s.editing === block.id) return <BlockEditor block={block} source={edit ?? block.raw} />;
	const noted = s.annotations.some((a) => a.spans.some((sp) => sp.block === block.id && sp.start === undefined));
	return (
		<div className={`blk ${edit !== undefined ? "edited" : ""} ${noted ? "noted" : ""}`} id={block.id}>
			{readOnly ? null : (
				<div className="gut">
					<button
						type="button"
						title="Comment on this block"
						onClick={(e) => {
							const r = (e.currentTarget.closest(".blk") as HTMLElement).getBoundingClientRect();
							openPop("block", undefined, {
								block: block.id,
								x: Math.min(r.left, innerWidth - 400),
								y: Math.min(r.top + 30, innerHeight - 280),
							});
						}}
					>
						<Icon.bubble />
					</button>
					{block.mermaid || block.code ? null : (
						<button
							type="button"
							title="Rewrite this block"
							onClick={() =>
								update((d) => {
									d.editing = block.id;
								})
							}
						>
							<Icon.pencil />
						</button>
					)}
				</div>
			)}
			<BlockContent id={edit === undefined ? block.id : undefined} html={renderBlock(block, edit ?? block.raw)} />
			{edit === undefined ? null : <RewriteTag block={block} after={edit} />}
		</div>
	);
}

/** The bar above a selection. Typing a letter while it shows starts a comment; the app handles that key. */
export function Toolbar() {
	const { page, s, update, order, openPop } = useDocReview();
	const toolbar = s.toolbar;
	if (!toolbar) return null;
	const mark = (type: "delete" | "label", label?: MarkdownLabel) => {
		getSelection()?.removeAllRanges();
		const added = annotation({ type, spans: toolbar.selected.spans, quote: toolbar.selected.quote, label });
		update((d) => {
			addAnnotation(d, added, order);
			d.toolbar = null;
		});
	};
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: keeps the selection while a toolbar button is pressed.
		<div className="tbar" style={{ left: toolbar.x, top: toolbar.y }} onMouseDown={(e) => e.preventDefault()}>
			<button type="button" className="main" onClick={() => openPop("comment", toolbar.selected)}>
				<Icon.bubble /> Comment
			</button>
			<span className="hint">or just type</span>
			<span className="sep" />
			{(Object.keys(LABELS) as MarkdownLabel[]).map((l) => (
				<button type="button" key={l} className="icon" title={LABELS[l].text} onClick={() => mark("label", l)}>
					{LABELS[l].emoji}
				</button>
			))}
			<span className="sep" />
			<button type="button" className="icon" title="Mark for deletion" onClick={() => mark("delete")}>
				<Icon.strike />
			</button>
			<button
				type="button"
				className="icon"
				title="Suggest a rewrite"
				onClick={() => openPop("suggest", toolbar.selected)}
			>
				<Icon.pencil />
			</button>
			{page.session.ask ? (
				<button type="button" className="icon" title="Ask the agent" onClick={() => openPop("ask", toolbar.selected)}>
					<Icon.spark />
				</button>
			) : null}
		</div>
	);
}

const COMPOSE_TITLE = {
	comment: "Comment",
	suggest: "Suggest a rewrite",
	ask: "Ask the agent",
	block: "Comment on the whole block",
	overall: "Overall comment",
};
const PLACEHOLDER = {
	comment: "Your comment",
	suggest: "",
	ask: "What do you want to know?",
	block: "Your comment",
	overall: "Feedback on the whole document",
};

export function Composer() {
	const { s, savePop } = useDocReview();
	const pop = s.pop;
	if (!pop || pop.kind === "view") return null;
	const kind = pop.kind;
	const value = kind === "suggest" ? pop.selected?.quote : kind === "overall" ? s.overall : pop.initial;
	return (
		<div className="pop" style={{ left: pop.x, top: pop.y }}>
			<div className="pop-h">
				{kind === "suggest" ? <Icon.pencil /> : kind === "ask" ? <Icon.spark /> : <Icon.bubble />}
				{COMPOSE_TITLE[kind]}
			</div>
			{pop.selected ? <div className="quote">{pop.selected.quote}</div> : null}
			{kind === "suggest" ? <div className="pop-h sub">Replace with</div> : null}
			<textarea
				id="pop-text"
				// biome-ignore lint/a11y/noAutofocus: the popover opens because the reviewer asked to write.
				autoFocus
				rows={kind === "suggest" ? 2 : 3}
				defaultValue={value ?? ""}
				placeholder={PLACEHOLDER[kind]}
				onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
			/>
			{kind === "suggest" ? <textarea id="pop-why" rows={2} placeholder="Why (optional)" /> : null}
			<div className="row">
				<span className="kbd-hint">
					<Kbd>⌘</Kbd>
					<Kbd>↵</Kbd> save · <Kbd>esc</Kbd> cancel
				</span>
				<span className="sp" />
				<button type="button" className="btn primary sm" onClick={savePop}>
					{kind === "ask" ? "Ask" : "Save"}
				</button>
			</div>
		</div>
	);
}

/** What a clicked highlight holds, with a way to remove it. Overlapping highlights show together. */
export function AnnotationPop() {
	const { s, update, readOnly } = useDocReview();
	const pop = s.pop;
	const shown = pop?.kind === "view" ? s.annotations.filter((a) => pop.ids?.includes(a.id)) : [];
	if (!pop || !shown.length) return null;
	return (
		<div className="pop" style={{ left: pop.x, top: pop.y }}>
			{shown.map((a) => (
				<div className="pop-item" key={a.id}>
					<div className="pop-h">
						{annotationTitle(a)}
						<span className="sp" />
						{readOnly ? null : (
							<button
								type="button"
								className="link"
								onClick={() =>
									update((d) => {
										d.annotations = d.annotations.filter((x) => x.id !== a.id);
										if (shown.length === 1) d.pop = null;
									})
								}
							>
								Remove
							</button>
						)}
					</div>
					{a.quote ? <div className="quote">{a.quote}</div> : null}
					{a.type === "suggest" ? (
						<div>
							→ <ins className="ins-inline">{a.replacement}</ins>
						</div>
					) : null}
					{a.text ? <div className="pop-text">{a.text}</div> : null}
					{a.type === "ask" ? (
						<div className="answer-box">{a.answer ? <Answer text={a.answer} /> : "The agent is answering…"}</div>
					) : null}
				</div>
			))}
		</div>
	);
}

export function Panel({ total }: { total: number }) {
	const { page, s, order, openPop, scrollTo, readOnly } = useDocReview();
	const lineOf = (id: string) => page.blocks[order.get(id) ?? 0].line;
	const reveal = (id: string, block: string) => {
		scrollTo(document.querySelector(`mark[data-an="${id}"]`) ?? document.getElementById(block), innerHeight / 3);
		for (const m of document.querySelectorAll<HTMLElement>(`mark[data-an="${id}"]`)) {
			m.classList.remove("flash");
			void m.offsetWidth;
			m.classList.add("flash");
		}
	};
	return (
		<aside className="panel">
			<div className="panel-h">
				<h3>Annotations</h3>
				<span className="count">{total}</span>
			</div>
			{s.overall.trim() ? (
				<button type="button" className="an-card" disabled={readOnly} onClick={() => openPop("overall")}>
					<span className="t overall">
						<Icon.bubble /> Overall comment
					</span>
					<span>{s.overall}</span>
				</button>
			) : null}
			{s.annotations.map((a) => (
				<button type="button" key={a.id} className="an-card" onClick={() => reveal(a.id, a.spans[0].block)}>
					<span className={`t ${a.type}`}>
						{annotationTitle(a)}
						<span className="sp" />
						<span className="ln">L{lineOf(a.spans[0].block)}</span>
					</span>
					<span className="q">{a.quote ?? "Whole block"}</span>
					{a.type === "suggest" ? (
						<span className="rep">
							→ <ins>{a.replacement}</ins>
						</span>
					) : null}
					{a.text ? <span>{a.text}</span> : null}
					{a.type === "ask" ? <Md className="dim" text={a.answer ?? "Answering…"} /> : null}
				</button>
			))}
			{Object.keys(s.edits).map((id) => (
				<button type="button" key={id} className="an-card" onClick={() => scrollTo(document.getElementById(id))}>
					<span className="t edit">
						<Icon.pencil /> Rewritten block
						<span className="sp" />
						<span className="ln">L{lineOf(id)}</span>
					</span>
				</button>
			))}
			{total === 0 ? (
				<div className="empty">
					Select text in the document to comment, mark it for deletion, suggest a rewrite, or label it. Hover a block to
					comment on it as a whole or rewrite it.
				</div>
			) : null}
		</aside>
	);
}

/** A centred sheet over the page; a click outside or Esc closes it. */
function Sheet({ title, children }: { title: string; children: ReactNode }) {
	const { update } = useDocReview();
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Escape closes the sheet.
		<div
			className="overlay"
			onClick={() =>
				update((d) => {
					d.modal = null;
				})
			}
		>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the panel only stops the overlay's click. */}
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<div className="modal-h">
					<h3>{title}</h3>
				</div>
				{children}
			</div>
		</div>
	);
}

export function Keys({ keys }: { keys: [string, string][] }) {
	const { s } = useDocReview();
	if (s.modal !== "keys") return null;
	return (
		<Sheet title="Keyboard">
			<div className="keys">
				{keys.map(([k, v]) => (
					<div key={k}>
						<span>{v}</span>
						<kbd>{k}</kbd>
					</div>
				))}
			</div>
		</Sheet>
	);
}

export function Finish() {
	const { s, update, submit, readOnly } = useDocReview();
	if (s.submit === "sent" && !readOnly)
		return (
			<div className="overlay sent">
				<div className="modal sent-card">
					<div className="sent-ic">
						<Icon.check />
					</div>
					<h3>{s.verdict === "dismissed" ? "Closed without a verdict" : "Review sent to the agent"}</h3>
					<p>You can close this tab. A copy of this page, with your annotations, is saved for later.</p>
				</div>
			</div>
		);
	if (s.modal !== "finish") return null;
	return (
		<Sheet title="Finish review">
			<div className="verdict">
				<div className="vd-stats">
					<span>
						<b>{s.annotations.length}</b> annotations
					</span>
					<span>
						<b>{Object.keys(s.edits).length}</b> rewritten blocks
					</span>
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
				<div className="vd-foot">
					<button type="button" className="link" onClick={() => submit("dismissed")}>
						Close without a verdict
					</button>
					<span className="sp" />
					{s.submit === "failed" ? (
						<span className="warn">Could not reach the agent. Is the session still open?</span>
					) : null}
					<button
						type="button"
						className="btn primary lg"
						disabled={!s.verdict || s.submit === "sending"}
						onClick={() => s.verdict && submit(s.verdict)}
					>
						<Icon.send /> Send to agent
					</button>
				</div>
			</div>
		</Sheet>
	);
}

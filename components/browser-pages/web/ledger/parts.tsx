import { memo, type ReactNode, useState } from "react";

import type { EvidenceFile, LedgerReviewPage, MarkdownBlock, Segment, Ticket } from "../../src/page-data";
import { graphProblems, type TicketState, ticketState } from "../../src/tickets";
import { Icon, Kbd } from "../ui";
import { lineHtml, renderBlock } from "../markdown/render";
import { chain, edges, layout, NODE } from "./graph";

export const STATE_LABEL: Record<TicketState, string> = {
	done: "Done",
	progress: "In progress",
	frontier: "Ready",
	blocked: "Blocked",
};
export const pad = (n: number) => String(n).padStart(2, "0");
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const svg = (d: ReactNode) => (
	<svg className="ic fi" viewBox="0 0 16 16" aria-hidden="true">
		{d}
	</svg>
);
const FileIcon = {
	graph: () =>
		svg(
			<>
				<rect x="1.8" y="2.5" width="4.4" height="3.6" rx="1" />
				<rect x="9.8" y="2.5" width="4.4" height="3.6" rx="1" />
				<rect x="5.8" y="9.9" width="4.4" height="3.6" rx="1" />
				<path d="M4 6.1v1.6c0 .6.4 1 1 1h1.8M12 6.1v1.6c0 .6-.4 1-1 1H9.2M8 8.7v1.2" />
			</>,
		),
	doc: () =>
		svg(
			<>
				<path d="M4 1.8h5.2L12.4 5v9.2H4z" />
				<path d="M9 1.8V5h3.4M6 8h4.4M6 10.6h4.4" />
			</>,
		),
	data: () =>
		svg(
			<path d="M5 2.5c-1.2 0-1.8.6-1.8 1.8v1.6c0 .9-.5 1.6-1.4 1.8.9.2 1.4.9 1.4 1.8v1.6c0 1.2.6 1.8 1.8 1.8M11 2.5c1.2 0 1.8.6 1.8 1.8v1.6c0 .9.5 1.6 1.4 1.8-.9.2-1.4.9-1.4 1.8v1.6c0 1.2-.6 1.8-1.8 1.8" />,
		),
	folder: () =>
		svg(<path d="M1.8 4.2c0-.6.4-1 1-1h3.4l1.4 1.5h5.6c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z" />),
	arrow: () => svg(<path d="M3 8h10M9.5 4.5L13 8l-3.5 3.5" />),
};
export const titleOf = (doc: { path: string; blocks: MarkdownBlock[] }) =>
	doc.blocks.find((b) => b.heading?.depth === 1)?.heading?.text ?? doc.path;

/** What the page knows about the bundle, shared by its parts. */
export interface Bundle {
	page: LedgerReviewPage;
	view: string;
	open: (path: string) => void;
	opened: Set<string>;
	/** Annotations and rewrites in a file, or in every file under a folder prefix ending in `/`. */
	count: (path: string) => number;
}

export function TicketChip({ ticket, bundle }: { ticket: Ticket; bundle: Bundle }) {
	const state = ticketState(ticket, bundle.page.tickets);
	return (
		<button type="button" className={`chip s-${state}`} onClick={() => bundle.open(ticket.path)}>
			<span className="st-dot" />
			<span className="cid">{pad(ticket.id)}</span>
			<span className="ct">{ticket.title}</span>
		</button>
	);
}

// ---------------------------------------------------------------------------- the tree

interface Folder {
	name: string;
	path: string;
	folders: Folder[];
	files: string[];
}

function folderTree(paths: string[]): Folder {
	const root: Folder = { name: "", path: "", folders: [], files: [] };
	for (const path of paths) {
		const parts = path.split("/");
		let folder = root;
		for (const name of parts.slice(0, -1)) {
			const at = `${folder.path}${name}/`;
			let next = folder.folders.find((f) => f.path === at);
			if (!next) {
				next = { name, path: at, folders: [], files: [] };
				folder.folders.push(next);
			}
			folder = next;
		}
		folder.files.push(path);
	}
	return root;
}
const filesIn = (f: Folder): number => f.files.length + f.folders.reduce((n, sub) => n + filesIn(sub), 0);

export function Tree({
	bundle,
	headings,
	current,
	goTo,
}: {
	bundle: Bundle;
	headings: MarkdownBlock[];
	current: string | undefined;
	goTo: (id: string) => void;
}) {
	const { page, view, open, opened, count } = bundle;
	const [closed, setClosed] = useState<Record<string, boolean>>({});
	const isClosed = (f: Folder) => closed[f.path] ?? f.path !== "tickets/";
	const docs = new Map(page.documents.map((d) => [d.path, d]));
	const root = folderTree([...page.documents.map((d) => d.path), ...page.evidence.map((e) => e.path)]);
	const tail = (path: string) => {
		const n = count(path);
		if (n) return <span className="t-n">{n}</span>;
		return opened.has(path) ? (
			<span className="t-seen" title="Opened">
				<Icon.check />
			</span>
		) : null;
	};

	const fileRow = (path: string, depth: number) => {
		const doc = docs.get(path);
		const ticket = page.tickets.find((t) => t.path === path);
		const on = view === path;
		const evidence = page.evidence.find((e) => e.path === path);
		const row = ticket ? (
			<button
				type="button"
				key={path}
				className={`t-row in${depth} s-${ticketState(ticket, page.tickets)} ${on ? "on" : ""}`}
				title={path}
				onClick={() => open(path)}
			>
				<span className="t-tid">{pad(ticket.id)}</span>
				<span className="nm">{ticket.title}</span>
				{ticket.total ? (
					<span className="t-meta">
						{ticket.done}/{ticket.total}
					</span>
				) : null}
				<span className="st-dot" title={STATE_LABEL[ticketState(ticket, page.tickets)]} />
				{tail(path)}
			</button>
		) : (
			<button
				type="button"
				key={path}
				className={`t-row in${depth} ${on ? "on" : ""}`}
				title={path}
				onClick={() => open(path)}
			>
				{doc ? <FileIcon.doc /> : <FileIcon.data />}
				<span className="nm mono">{path.split("/").pop()}</span>
				{evidence ? <span className="t-meta">{kb(evidence.bytes)}</span> : null}
				{tail(path)}
			</button>
		);
		if (!on || !doc) return row;
		return [
			row,
			...headings.map((h) => (
				<button
					type="button"
					key={`${path}#${h.id}`}
					className={`t-sub d${h.heading?.depth} ${current === h.id ? "on" : ""}`}
					onClick={() => goTo(h.id)}
				>
					{h.heading?.text}
				</button>
			)),
		];
	};

	const folderRows = (f: Folder, depth: number): ReactNode[] => {
		const shut = isClosed(f);
		const n = count(f.path);
		return [
			<button
				type="button"
				key={f.path}
				className={`t-row t-folder in${depth}`}
				onClick={() => setClosed((c) => ({ ...c, [f.path]: !shut }))}
			>
				{Icon.chevron(shut)}
				<FileIcon.folder />
				<span className="nm mono">{f.name}/</span>
				<span className="t-meta">{filesIn(f)}</span>
				{n ? <span className="t-n">{n}</span> : null}
			</button>,
			...(shut
				? []
				: [
						...f.folders.flatMap((sub) => folderRows(sub, depth + 1)),
						...f.files.flatMap((p) => fileRow(p, depth + 1)),
					]),
		];
	};

	const before = root.files.filter((p) => docs.has(p) && p !== "retrospective.md");
	const tickets = root.folders.find((f) => f.path === "tickets/");
	const others = root.folders.filter((f) => f !== tickets);
	return (
		<nav className="tree">
			<button type="button" className={`t-row ${view === "overview" ? "on" : ""}`} onClick={() => open("overview")}>
				<FileIcon.graph />
				<span className="nm">Overview</span>
				<Kbd>G</Kbd>
			</button>
			<div className="t-sec">Bundle</div>
			{before.flatMap((p) => fileRow(p, 0))}
			{tickets ? folderRows(tickets, 0) : null}
			{docs.has("retrospective.md") ? fileRow("retrospective.md", 0) : null}
			{others.flatMap((f) => folderRows(f, 0))}
			{root.files.filter((p) => !docs.has(p)).flatMap((p) => fileRow(p, 0))}
			<div className="t-keys">
				<span>
					<Kbd>[</Kbd> <Kbd>]</Kbd> previous / next document
				</span>
				<span>
					<Kbd>J</Kbd> <Kbd>K</Kbd> sections
				</span>
			</div>
		</nav>
	);
}

// ---------------------------------------------------------------------------- the overview

const ReadOnlyBlocks = memo(function ReadOnlyBlocks({ blocks }: { blocks: MarkdownBlock[] }) {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: renderBlock escapes all document text and drops unsafe URLs.
	return <div dangerouslySetInnerHTML={{ __html: blocks.map((b) => renderBlock(b)).join("") }} />;
});

/** The blocks under `task.md`'s `## Intent` heading, up to the next heading of the same depth. */
function intentOf(page: LedgerReviewPage): MarkdownBlock[] {
	const blocks = page.documents.find((d) => d.path === "task.md")?.blocks ?? [];
	const start = blocks.findIndex((b) => b.heading && /^intent$/i.test(b.heading.text.trim()));
	if (start < 0) return [];
	const depth = blocks[start].heading?.depth ?? 2;
	const end = blocks.findIndex((b, i) => i > start && b.heading && b.heading.depth <= depth);
	return blocks.slice(start + 1, end < 0 ? undefined : end);
}

function TicketGraph({ bundle }: { bundle: Bundle }) {
	const { tickets } = bundle.page;
	const [hover, setHover] = useState<number | null>(null);
	const { pos, width, height } = layout(tickets);
	const lines = edges(tickets, pos);
	const problems = graphProblems(tickets);
	const hot = hover === null ? null : chain(tickets, hover);
	const isHot = (id: number) => !hot || hot.up.has(id) || hot.down.has(id);
	const edgeHot = (from: number, to: number) =>
		!!hot && ((hot.up.has(from) && hot.up.has(to)) || (hot.down.has(from) && hot.down.has(to)));
	const loops = lines.some((e) => pos.get(e.to)!.x <= pos.get(e.from)!.x);
	const frontier = tickets.filter((t) => ticketState(t, tickets) === "frontier");
	const allDone = tickets.every((t) => ticketState(t, tickets) === "done");
	return (
		<section className="graph-card">
			<div className="gc-h">
				<h2>Tickets</h2>
				<span className="count">{tickets.length}</span>
				<span className="lt-legend">
					{(["frontier", "progress", "blocked", "done"] as const).map((s) => (
						<span key={s} className={`s-${s}`}>
							<span className="st-dot" />
							{STATE_LABEL[s]}
						</span>
					))}
				</span>
				{problems.length ? (
					<span className="checks bad">
						<Icon.warn /> {problems.length} graph {problems.length === 1 ? "problem" : "problems"}
					</span>
				) : (
					<span className="checks">
						<Icon.check /> Graph checks pass
					</span>
				)}
			</div>
			{problems.length ? (
				<div className="problems">
					{problems.map((p) => (
						<div key={p}>{p}</div>
					))}
				</div>
			) : null}
			<div className="graph-wrap">
				<div className={`graph ${hot ? "hovering" : ""}`} style={{ width, height: height + (loops ? 130 : 0) }}>
					<svg aria-hidden="true">
						{lines.map((e) => (
							<g key={`${e.from}-${e.to}`} className={edgeHot(e.from, e.to) ? "hot" : ""}>
								<path className={`edge ${e.kind}`} d={e.d} />
								<path className={`edge-head ${e.kind}`} d={e.head} />
							</g>
						))}
					</svg>
					{tickets.map((t) => {
						const state = ticketState(t, tickets);
						const p = pos.get(t.id)!;
						const n = bundle.count(t.path);
						return (
							<button
								type="button"
								key={t.id}
								className={`node s-${state} ${isHot(t.id) ? "hot" : ""}`}
								style={{ left: p.x, top: p.y, width: NODE.w, height: NODE.h }}
								onClick={() => bundle.open(t.path)}
								onMouseEnter={() => setHover(t.id)}
								onMouseLeave={() => setHover(null)}
								onFocus={() => setHover(t.id)}
								onBlur={() => setHover(null)}
							>
								<span className="n-top">
									<span className="n-id">{pad(t.id)}</span>
									<span className="n-st">{STATE_LABEL[state]}</span>
									{n ? (
										<span className="n-an">
											<Icon.bubble />
											{n}
										</span>
									) : null}
								</span>
								<span className="n-title">{t.title}</span>
								<span className="n-crit">
									<span className="bar">
										<i style={{ width: `${t.total ? (100 * t.done) / t.total : 0}%` }} />
									</span>
									{t.done}/{t.total} criteria
								</span>
							</button>
						);
					})}
				</div>
			</div>
			<div className="gc-foot">
				{frontier.length ? (
					<>
						<b>Can start now:</b>
						{frontier.map((t) => (
							<TicketChip key={t.id} ticket={t} bundle={bundle} />
						))}
					</>
				) : allDone ? (
					<b>Every ticket is done.</b>
				) : (
					<span>
						<b>Nothing can start now.</b> Every open ticket waits on another.
					</span>
				)}
			</div>
		</section>
	);
}

export function Overview({ bundle, banner }: { bundle: Bundle; banner: ReactNode }) {
	const { page, open, count } = bundle;
	const intent = intentOf(page);
	const docs = page.documents.filter((d) => !page.tickets.some((t) => t.path === d.path));
	return (
		<div className="wide">
			{banner}
			<div className="lt-k">{page.path}</div>
			<h1 className="lt-title">{page.title}</h1>
			<div className="lt-meta">
				{page.created ? <span>Created {page.created}</span> : null}
				{page.updated ? <span>Updated {page.updated}</span> : null}
				<span>
					{page.documents.length} documents{page.evidence.length ? ` · ${page.evidence.length} other files` : ""}
				</span>
			</div>
			{intent.length ? (
				<section className="lt-intent">
					<div className="lt-label">
						Intent
						<button type="button" className="link" onClick={() => open("task.md")}>
							Read task.md <FileIcon.arrow />
						</button>
					</div>
					<ReadOnlyBlocks blocks={intent} />
				</section>
			) : null}
			{page.tickets.length ? <TicketGraph bundle={bundle} /> : null}
			<div className="lt-label lt-docs-k">Documents</div>
			<div className="docs">
				{docs.map((d) => (
					<button type="button" key={d.path} className="doc-card" onClick={() => open(d.path)}>
						<span className="dp">
							<FileIcon.doc />
							<span className="nm">{d.path}</span>
							{count(d.path) ? <span className="t-n">{count(d.path)}</span> : null}
						</span>
						<span className="dt">{titleOf(d)}</span>
						<span className="dm">
							{d.blocks.at(-1)?.endLine ?? 0} lines · {d.blocks.filter((b) => (b.heading?.depth ?? 9) === 2).length}{" "}
							sections
						</span>
					</button>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------- a ticket's neighbourhood

export function TicketFlow({ ticket, bundle }: { ticket: Ticket; bundle: Bundle }) {
	const { tickets } = bundle.page;
	const before = ticket.blockers.flatMap((b) => tickets.find((t) => t.id === b) ?? []);
	const after = tickets.filter((t) => t.blockers.includes(ticket.id) && t.id !== ticket.id);
	const state = ticketState(ticket, tickets);
	return (
		<div className="tk-flow">
			<div className="tk-col in">
				<span className="tk-lbl">Blocked by</span>
				{before.map((t) => (
					<TicketChip key={t.id} ticket={t} bundle={bundle} />
				))}
				{ticket.unknown.map((n) => (
					<span key={n} className="chip missing">
						<span className="cid">{pad(n)}</span>
						<span className="ct">not in this bundle</span>
					</span>
				))}
				{before.length || ticket.unknown.length ? null : <span className="tk-none">Nothing: it can start first</span>}
			</div>
			<div className="tk-mid">
				<span className="tk-arrow">
					<FileIcon.arrow />
				</span>
				<div className={`tk-self s-${state}`}>
					<span className="cid">{pad(ticket.id)}</span>
					<span className="status-chip">{STATE_LABEL[state]}</span>
				</div>
				<span className="tk-arrow">
					<FileIcon.arrow />
				</span>
			</div>
			<div className="tk-col">
				<span className="tk-lbl">Unblocks</span>
				{after.map((t) => (
					<TicketChip key={t.id} ticket={t} bundle={bundle} />
				))}
				{after.length ? null : <span className="tk-none">Nothing: it ends the graph</span>}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------- an evidence file

/** One line of an evidence file. Its text sits in a `data-content` span so selections and highlights index only it. */
const EvidenceLine = memo(function EvidenceLine({ n, line }: { n: number; line: Segment[] }) {
	return (
		<div className="cvl" id={`l${n}`}>
			<span className="cv-n">{n}</span>
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: lineHtml escapes the text and admits only colour tokens. */}
			<span className="cv-t" data-content={`l${n}`} dangerouslySetInnerHTML={{ __html: lineHtml(line) || " " }} />
		</div>
	);
});

export type Loaded = Pick<EvidenceFile, "lines" | "binary"> & { error?: string };

export function EvidenceBody({
	file,
	loaded,
	live,
}: {
	file: EvidenceFile;
	loaded: Loaded | undefined;
	live: boolean;
}) {
	if (loaded?.lines)
		return (
			<div className="doc codeview">
				{loaded.lines.map((line, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional.
					<EvidenceLine key={i} n={i + 1} line={line} />
				))}
			</div>
		);
	const message = loaded?.binary
		? "This file is not text, so the page cannot show it."
		: loaded?.error
			? `The file could not be read: ${loaded.error}`
			: live
				? "Loading…"
				: "The reviewer did not open this file, so the saved page does not include it.";
	return (
		<div className="ondemand">
			<b>{file.path}</b>
			<span>
				{kb(file.bytes)}. {message}
			</span>
		</div>
	);
}

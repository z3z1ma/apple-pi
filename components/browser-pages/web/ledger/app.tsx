import { useEffect, useMemo, useState } from "react";

import type { LedgerReviewPage } from "../../src/page-data";
import { DocReviewContext } from "../markdown/context";
import { Block, Panel } from "../markdown/parts";
import { Banner, Floats, READER_KEYS, TopBar, useReader } from "../markdown/review";
import { blockKey, splitKey } from "../markdown/state";
import { type Bundle, EvidenceBody, type Loaded, Overview, TicketChip, TicketFlow, titleOf, Tree } from "./parts";

const KEYS: [string, string][] = [
	["G", "Overview and ticket graph"],
	["[ / ]", "Previous / next document"],
	...READER_KEYS,
];

export function LedgerReview({ page }: { page: LedgerReviewPage }) {
	const live = page.session.live;
	const [view, setView] = useState("overview");
	const [opened, setOpened] = useState(() => new Set(page.result?.opened ?? []));
	const [loaded, setLoaded] = useState<Record<string, Loaded>>(() =>
		Object.fromEntries(page.evidence.filter((e) => e.lines || e.binary).map((e) => [e.path, e])),
	);
	const doc = page.documents.find((d) => d.path === view);
	const evidence = page.evidence.find((e) => e.path === view);
	const file = doc || evidence ? view : "";

	// Every block's place in the review: documents in reading order, then evidence files, each line by line.
	const files = useMemo(() => [...page.documents.map((d) => d.path), ...page.evidence.map((e) => e.path)], [page]);
	const blockIndex = useMemo(
		() => new Map(page.documents.flatMap((d) => d.blocks.map((b, i) => [blockKey(d.path, b.id), i] as const))),
		[page],
	);
	const position = (path: string, block: string) =>
		files.indexOf(path) * 1e9 + (blockIndex.get(blockKey(path, block)) ?? Number(block.slice(1)));
	const lineOf = (path: string, block: string) =>
		page.documents.find((d) => d.path === path)?.blocks.find((b) => b.id === block)?.line ?? Number(block.slice(1));
	const headings = useMemo(
		() => doc?.blocks.filter((b) => b.heading && b.heading.depth > 1 && b.heading.depth < 4) ?? [],
		[doc],
	);
	const order = page.documents.map((d) => d.path);
	const open = (path: string) => {
		reader.stage.current?.scrollTo({ top: 0 });
		setView(path);
		if (path !== "overview") setOpened((o) => (o.has(path) ? o : new Set(o).add(path)));
	};
	const step = (by: number) => {
		const i = order.indexOf(view);
		const next = i < 0 ? (by > 0 ? order[0] : undefined) : order[i + by];
		if (next) open(next);
		else if (i === 0 && by < 0) open("overview");
	};

	const reader = useReader({
		session: page.session,
		result: page.result,
		defaultFile: "task.md",
		file,
		headings,
		position,
		lineOf,
		open,
		onKey: (e) => {
			if (e.key === "g") open("overview");
			else if (e.key === "]" || e.key === "[") step(e.key === "]" ? 1 : -1);
			else return false;
			return true;
		},
		extra: () => ({ opened: [...opened] }),
	});
	const { s } = reader;

	// An evidence file loads when first opened; a saved page shows only the files the reviewer opened.
	useEffect(() => {
		if (!evidence || loaded[evidence.path] || !live) return;
		const path = evidence.path;
		fetch(`/file?path=${encodeURIComponent(path)}`, { headers: { "x-page-token": page.session.token } })
			.then(async (r) => (r.ok ? ((await r.json()) as Loaded) : { error: await r.text() }))
			.catch(() => ({ error: "the session is no longer open" }))
			.then((value) => setLoaded((l) => ({ ...l, [path]: value })));
	}, [evidence, loaded, live, page.session.token]);

	const count = (path: string) => {
		const inside = (f: string) => (path.endsWith("/") ? f.startsWith(path) : f === path);
		return (
			s.annotations.filter((a) => inside(a.file)).length +
			Object.keys(s.edits).filter((k) => inside(splitKey(k).file)).length
		);
	};
	const bundle: Bundle = { page, view, open, opened, count };
	const fromFinish: Bundle = {
		...bundle,
		open: (path) => {
			reader.update((d) => {
				d.modal = null;
			});
			open(path);
		},
	};
	const ticket = page.tickets.find((t) => t.path === view);
	const i = order.indexOf(view);
	const unopened = page.documents.filter((d) => !opened.has(d.path));
	const banner = <Banner result={page.result} note={page.note} />;
	const lines = doc ? (doc.blocks.at(-1)?.endLine ?? 0) : (loaded[view]?.lines?.length ?? 0);

	return (
		<DocReviewContext.Provider value={reader.review}>
			<div className="app md-app">
				<TopBar title={page.title} path={page.path} total={reader.total}>
					{page.status ? <span className="status-chip s-task">{page.status}</span> : null}
				</TopBar>
				<div className={`md-body ledger-body ${s.panel ? "with-panel" : ""}`}>
					<Tree bundle={bundle} headings={headings} current={reader.current} goTo={reader.goTo} />
					<main className="stage" ref={reader.stage} onScroll={reader.onScroll}>
						{view === "overview" || !(doc || evidence) ? (
							<Overview bundle={bundle} banner={banner} />
						) : (
							<article className={`paper ${evidence ? "wide-paper" : ""}`}>
								{i === 0 ? banner : null}
								<div className="doc-path">
									<span>{view}</span>
									<span className="sp" />
									{lines ? <span>{lines} lines</span> : null}
								</div>
								{ticket ? <TicketFlow ticket={ticket} bundle={bundle} /> : null}
								{doc ? (
									// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: highlights open with a click; the annotations panel is the keyboard path.
									<div className="doc" onClick={reader.onDocClick}>
										{doc.blocks.map((b) => (
											<Block key={`${view}#${b.id}`} block={b} />
										))}
									</div>
								) : evidence ? (
									// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: highlights open with a click; the annotations panel is the keyboard path.
									<div onClick={reader.onDocClick}>
										<EvidenceBody file={evidence} loaded={loaded[view]} live={live} />
									</div>
								) : null}
								{doc ? (
									<div className="pager">
										{i > 0 ? (
											<button type="button" onClick={() => step(-1)}>
												<span className="pk">‹ Previous · [</span>
												<span className="pt">{titleOf(page.documents[i - 1])}</span>
											</button>
										) : (
											<span />
										)}
										{i < order.length - 1 ? (
											<button type="button" className="next" onClick={() => step(1)}>
												<span className="pk">] · Next ›</span>
												<span className="pt">{titleOf(page.documents[i + 1])}</span>
											</button>
										) : (
											<span />
										)}
									</div>
								) : null}
							</article>
						)}
					</main>
					{s.panel ? <Panel total={reader.total} grouped /> : null}
				</div>
				<Floats
					keys={KEYS}
					finish={
						unopened.length ? (
							<div className="unopened">
								<span>You have not opened:</span>
								<div className="row">
									{unopened.map((d) => {
										const t = page.tickets.find((x) => x.path === d.path);
										return t ? (
											<TicketChip key={d.path} ticket={t} bundle={fromFinish} />
										) : (
											<button type="button" key={d.path} className="chip" onClick={() => fromFinish.open(d.path)}>
												<span className="ct">{d.path}</span>
											</button>
										);
									})}
								</div>
							</div>
						) : null
					}
				/>
			</div>
		</DocReviewContext.Provider>
	);
}

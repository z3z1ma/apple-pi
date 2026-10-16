import { useMemo } from "react";

import type { MarkdownReviewPage } from "../../src/page-data";
import { Kbd } from "../ui";
import { DocReviewContext } from "./context";
import { Block, Panel } from "./parts";
import { Banner, Floats, READER_KEYS, TopBar, useReader } from "./review";

export function MarkdownReview({ page }: { page: MarkdownReviewPage }) {
	const order = useMemo(() => new Map(page.blocks.map((b, i) => [b.id, i])), [page.blocks]);
	const headings = useMemo(() => page.blocks.filter((b) => b.heading && b.heading.depth > 1), [page.blocks]);
	const reader = useReader({
		session: page.session,
		result: page.result,
		defaultFile: page.path,
		file: page.path,
		headings,
		position: (_file, block) => order.get(block) ?? 0,
		lineOf: (_file, block) => page.blocks[order.get(block) ?? 0].line,
		open: () => {},
	});
	const { s, current, goTo, total } = reader;

	const sectionCount = (id: string) => {
		const i = order.get(id) ?? 0;
		const depth = page.blocks[i].heading?.depth ?? 6;
		const end = page.blocks.findIndex((b, k) => k > i && b.heading && b.heading.depth <= depth);
		const ids = new Set(page.blocks.slice(i, end < 0 ? undefined : end).map((b) => b.id));
		return s.annotations.filter((a) => a.spans.some((sp) => ids.has(sp.block))).length;
	};

	return (
		<DocReviewContext.Provider value={reader.review}>
			<div className="app md-app">
				<TopBar title={page.title} path={page.path} total={total} />
				<div className={`md-body ${s.panel ? "with-panel" : ""}`}>
					<nav className="outline">
						<div className="o-k">Outline</div>
						{headings.map((h) => {
							const n = sectionCount(h.id);
							return (
								<button
									type="button"
									key={h.id}
									className={`o-item d${h.heading?.depth} ${current === h.id ? "on" : ""}`}
									onClick={() => goTo(h.id)}
								>
									{h.heading?.text}
									{n ? <span className="o-n">{n}</span> : null}
								</button>
							);
						})}
						<div className="o-keys">
							<Kbd>J</Kbd> <Kbd>K</Kbd> sections
						</div>
					</nav>
					<main className="stage" ref={reader.stage} onScroll={reader.onScroll}>
						<article className="paper">
							<Banner result={page.result} note={page.note} />
							{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: highlights open with a click; the annotations panel is the keyboard path. */}
							<div className="doc" onClick={reader.onDocClick}>
								{page.blocks.map((b) => (
									<Block key={b.id} block={b} />
								))}
							</div>
						</article>
					</main>
					{s.panel ? <Panel total={total} grouped={false} /> : null}
				</div>
				<Floats keys={READER_KEYS} />
			</div>
		</DocReviewContext.Provider>
	);
}

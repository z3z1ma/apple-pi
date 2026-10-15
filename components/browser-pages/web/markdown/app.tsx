import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { MarkdownReviewPage, TextSpan, Verdict } from "../../src/page-data";
import { Icon, Kbd } from "../ui";
import { type DocReview, DocReviewContext } from "./context";
import { annotationsAt, applyMarks, readSelection } from "./marks";
import { drawDiagrams } from "./mermaid";
import { AnnotationPop, Block, Composer, Finish, Keys as KeySheet, Panel, Toolbar } from "./parts";
import { addAnnotation, composed, initial, LABELS, popAt, type State, VERDICTS } from "./state";

async function post(path: string, token: string, body: unknown): Promise<Response> {
	return fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json", "x-page-token": token },
		body: JSON.stringify(body),
	});
}

async function askAgent(token: string, spans: TextSpan[], quote: string | undefined, question: string) {
	try {
		const response = await post("/ask", token, { spans, quote, question });
		if (!response.ok) return `The agent could not answer: ${await response.text()}`;
		return ((await response.json()) as { answer?: string }).answer ?? "No answer.";
	} catch {
		return "Could not reach the agent. Is the session still open?";
	}
}

/** Highlights for the annotations on text, drawn over blocks the reviewer has not rewritten. */
function drawMarks(s: State): void {
	applyMarks(
		s.annotations
			.filter((a) => a.spans.some((sp) => sp.start !== undefined))
			.map((a) => ({
				id: a.id,
				spans: a.spans,
				className: `${a.type} ${a.label ?? ""}`,
				after:
					a.type === "suggest"
						? { tag: "ins" as const, className: "ins", text: a.replacement ?? "" }
						: a.type === "label"
							? { tag: "span" as const, className: "badge", text: LABELS[a.label ?? "good"].emoji }
							: undefined,
			})),
	);
}

interface Keys {
	s: State;
	review: DocReview;
	section: (step: number) => void;
}

/** The keys `onKey` handles, for the keyboard sheet. */
export const KEYS: [string, string][] = [
	["Type over a selection", "Comment on the selected text"],
	["J / K", "Next / previous section"],
	["⌘↵", "Save the open note, or finish the review"],
	["Esc", "Close"],
	["?", "Show or hide this list"],
];

/** ⌘↵ saves or finishes, Esc closes, a letter over a selection starts a comment, J and K move between sections. */
function onKey(e: KeyboardEvent, { s, review, section }: Keys): void {
	const { update, readOnly } = review;
	const typing = (e.target as Element).closest?.("textarea, input");
	const modified = e.metaKey || e.ctrlKey || e.altKey;
	if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
		e.preventDefault();
		if (readOnly) return;
		if (s.pop && s.pop.kind !== "view") review.savePop();
		else if (s.editing) document.getElementById("edit-save")?.click();
		else if (s.modal === "finish" && s.verdict && s.verdict !== "dismissed") review.submit(s.verdict);
		else
			update((d) => {
				d.modal = "finish";
			});
	} else if (e.key === "Escape") {
		update((d) => {
			if (d.pop || d.toolbar) {
				d.pop = null;
				d.toolbar = null;
			} else if (d.editing) d.editing = null;
			else d.modal = null;
		});
	} else if (s.toolbar && !typing && !modified && e.key.length === 1) {
		e.preventDefault();
		review.openPop("comment", s.toolbar.selected, { initial: e.key });
	} else if (!typing && e.key === "?") {
		update((d) => {
			d.modal = d.modal === "keys" ? null : "keys";
		});
	} else if (!typing && !modified && !s.modal && !s.pop && (e.key === "j" || e.key === "k")) {
		e.preventDefault();
		section(e.key === "j" ? 1 : -1);
	}
}

export function MarkdownReview({ page }: { page: MarkdownReviewPage }) {
	const readOnly = !page.session.live;
	const [s, setState] = useState<State>(() => initial(page));
	const update = useCallback((change: (draft: State) => void) => {
		setState((previous) => {
			const draft = structuredClone(previous);
			change(draft);
			return draft;
		});
	}, []);
	const stateRef = useRef(s);
	stateRef.current = s;
	const order = useMemo(() => new Map(page.blocks.map((b, i) => [b.id, i])), [page.blocks]);
	const headings = useMemo(() => page.blocks.filter((b) => b.heading && b.heading.depth > 1), [page.blocks]);
	const [current, setCurrent] = useState(headings[0]?.id);
	const stage = useRef<HTMLElement>(null);

	useEffect(() => {
		document.documentElement.dataset.theme = s.theme;
	}, [s.theme]);
	// Highlights are DOM decorations over the rendered blocks; reapply them after every render.
	useLayoutEffect(() => drawMarks(s));
	useEffect(() => {
		void drawDiagrams(s.theme);
	});

	const savePop = () => {
		const pop = stateRef.current.pop;
		if (!pop) return;
		const text = (document.getElementById("pop-text") as HTMLTextAreaElement | null)?.value.trim() ?? "";
		const why = (document.getElementById("pop-why") as HTMLTextAreaElement | null)?.value.trim() || undefined;
		const added = pop.kind === "overall" ? undefined : composed(pop, text, why);
		update((d) => {
			d.pop = null;
			if (pop.kind === "overall") d.overall = text;
			else if (added) addAnnotation(d, added, order);
		});
		if (added?.type !== "ask") return;
		void askAgent(page.session.token, added.spans, added.quote, text).then((answer) =>
			update((d) => {
				const asked = d.annotations.find((x) => x.id === added.id);
				if (asked) asked.answer = answer;
			}),
		);
	};

	const submit = async (verdict: Verdict) => {
		update((d) => {
			d.submit = "sending";
		});
		const st = stateRef.current;
		const body = {
			verdict,
			overall: st.overall.trim() || undefined,
			annotations: st.annotations.map(({ id: _id, ...a }) => a),
			edits: Object.entries(st.edits).map(([block, after]) => ({ block, after })),
		};
		const ok = await post("/result", page.session.token, body).then(
			(r) => r.ok,
			() => false,
		);
		update((d) => {
			d.submit = ok ? "sent" : "failed";
			if (ok) {
				d.verdict = verdict;
				d.modal = null;
			}
		});
	};

	const scrollTo = (el: Element | null, offset = 24) => {
		const box = stage.current;
		if (!el || !box) return;
		const to = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - offset;
		// Long jumps land at once; a smooth scroll across a long document only delays the answer.
		box.scrollTo({ top: to, behavior: Math.abs(to - box.scrollTop) > box.clientHeight * 2 ? "auto" : "smooth" });
	};
	const goTo = (id: string) => {
		setCurrent(id);
		scrollTo(document.getElementById(id));
	};
	const section = (step: number) => {
		const i = headings.findIndex((h) => h.id === current);
		const next = headings[Math.max(0, Math.min(headings.length - 1, i + step))];
		if (next) goTo(next.id);
	};
	/** The current section is the last heading above a line near the top of the stage. */
	const onScroll = () => {
		const top = (stage.current?.getBoundingClientRect().top ?? 0) + 140;
		const passed = headings.filter((h) => (document.getElementById(h.id)?.getBoundingClientRect().top ?? 0) < top);
		setCurrent((passed.at(-1) ?? headings[0])?.id);
		if (stateRef.current.toolbar || stateRef.current.pop)
			update((d) => {
				d.toolbar = null;
				d.pop = null;
			});
	};

	const openPop: DocReview["openPop"] = (kind, selected, extra = {}) => {
		getSelection()?.removeAllRanges();
		update((d) => {
			d.toolbar = null;
			d.pop = { kind, ...popAt(selected?.rect), selected, ...extra };
		});
	};

	const review: DocReview = { page, s, update, readOnly, order, openPop, savePop, scrollTo, submit };
	const keys = useRef<Keys>({ s, review, section });
	keys.current = { s, review, section };

	// Selecting document text opens the toolbar above it.
	useEffect(() => {
		const onMouseUp = (e: MouseEvent) => {
			if (readOnly || (e.target as Element).closest(".tbar, .pop, .modal, textarea, .gut")) return;
			setTimeout(() => {
				const selected = readSelection();
				update((d) => {
					d.toolbar = selected
						? {
								selected,
								x: Math.min(Math.max(12, selected.rect.left + selected.rect.width / 2 - 170), innerWidth - 360),
								y: Math.max(60, selected.rect.top - 48),
							}
						: null;
					if (selected) d.pop = null;
				});
			});
		};
		const keyDown = (e: KeyboardEvent) => onKey(e, keys.current);
		document.addEventListener("mouseup", onMouseUp);
		document.addEventListener("keydown", keyDown);
		return () => {
			document.removeEventListener("mouseup", onMouseUp);
			document.removeEventListener("keydown", keyDown);
		};
	}, [readOnly, update]);

	const onDocClick = (e: React.MouseEvent) => {
		const ids = annotationsAt(e.target as Element);
		if (!ids.length || !getSelection()?.isCollapsed) return;
		const r = (e.target as Element).getBoundingClientRect();
		update((d) => {
			d.pop = {
				kind: "view",
				ids,
				x: Math.min(r.left, innerWidth - 400),
				y: Math.min(r.bottom + 8, innerHeight - 280),
			};
		});
	};

	const sectionCount = (id: string) => {
		const i = order.get(id) ?? 0;
		const depth = page.blocks[i].heading?.depth ?? 6;
		const end = page.blocks.findIndex((b, k) => k > i && b.heading && b.heading.depth <= depth);
		const ids = new Set(page.blocks.slice(i, end < 0 ? undefined : end).map((b) => b.id));
		return s.annotations.filter((a) => a.spans.some((sp) => ids.has(sp.block))).length;
	};
	const total = s.annotations.length + Object.keys(s.edits).length + (s.overall.trim() ? 1 : 0);
	const verdictLabel = VERDICTS.find((v) => v.id === s.verdict)?.label ?? "Closed without a verdict";

	return (
		<DocReviewContext.Provider value={review}>
			<div className="app md-app">
				<header className="top">
					<span className="logo" aria-hidden="true">
						🥧
					</span>
					<span className="top-title">{page.title}</span>
					<span className="path-chip">{page.path}</span>
					<span className="sp" />
					{readOnly ? null : (
						<button type="button" className="btn ghost" onClick={() => openPop("overall")}>
							<Icon.bubble /> Overall comment
						</button>
					)}
					<button
						type="button"
						className={`count-pill ${s.panel ? "on" : ""}`}
						onClick={() =>
							update((d) => {
								d.panel = !d.panel;
							})
						}
					>
						Annotations <span className="n">{total}</span>
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
						<span className={`verdict-badge vd-${s.verdict}`}>{verdictLabel}</span>
					) : (
						<button
							type="button"
							className="btn primary"
							onClick={() =>
								update((d) => {
									d.modal = "finish";
								})
							}
						>
							Finish review <Kbd>⌘↵</Kbd>
						</button>
					)}
				</header>
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
					<main className="stage" ref={stage} onScroll={onScroll}>
						<article className="paper">
							{page.result ? (
								<div className="saved-banner">
									<Icon.check /> Reviewed {new Date(page.result.submittedAt).toLocaleString()} · <b>{verdictLabel}</b>
									{page.result.overall ? <span className="saved-summary">“{page.result.overall}”</span> : null}
								</div>
							) : null}
							{page.note && !s.noteHidden ? (
								<div className="agent-line">
									<Icon.spark />
									<span>{page.note}</span>
									<span className="sp" />
									<button
										type="button"
										className="link"
										onClick={() =>
											update((d) => {
												d.noteHidden = true;
											})
										}
									>
										Hide
									</button>
								</div>
							) : null}
							{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: highlights open with a click; the annotations panel is the keyboard path. */}
							<div className="doc" onClick={onDocClick}>
								{page.blocks.map((b) => (
									<Block key={b.id} block={b} />
								))}
							</div>
						</article>
					</main>
					{s.panel ? <Panel total={total} /> : null}
				</div>
				{readOnly ? null : <Toolbar />}
				<Composer />
				<AnnotationPop />
				<Finish />
				<KeySheet keys={KEYS} />
			</div>
		</DocReviewContext.Provider>
	);
}

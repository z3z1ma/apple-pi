import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { MarkdownBlock, TextSpan, Verdict } from "../../src/page-data";
import { Icon, Kbd } from "../ui";
import { useConnected } from "../connected";
import { type DocReview, useDocReview } from "./context";
import { annotationsAt, applyMarks, readSelection } from "./marks";
import { drawDiagrams } from "./mermaid";
import { AnnotationPop, Composer, Finish, Keys, Toolbar } from "./parts";
import {
	addAnnotation,
	composed,
	initial,
	LABELS,
	popAt,
	type SavedReview,
	type State,
	splitKey,
	VERDICTS,
} from "./state";

async function post(path: string, token: string, body: unknown): Promise<Response> {
	return fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json", "x-page-token": token },
		body: JSON.stringify(body),
	});
}

async function askAgent(
	token: string,
	file: string,
	spans: TextSpan[],
	quote: string | undefined,
	question: string,
	onUnreachable: () => void,
) {
	try {
		const response = await post("/ask", token, { file, spans, quote, question });
		if (!response.ok) {
			onUnreachable();
			return `The agent could not answer: ${await response.text()}`;
		}
		return ((await response.json()) as { answer?: string }).answer ?? "No answer.";
	} catch {
		onUnreachable();
		return "Could not reach the agent. Is the session still open?";
	}
}

/** Highlights for the annotations on text in `file`, drawn over blocks the reviewer has not rewritten. */
function drawMarks(s: State, file: string): void {
	applyMarks(
		s.annotations
			.filter((a) => a.file === file && a.spans.some((sp) => sp.start !== undefined))
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

/** The keys every reader page has; a page lists its own first. */
export const READER_KEYS: [string, string][] = [
	["J / K", "Next / previous section"],
	["Type over a selection", "Comment on the selected text"],
	["⌘↵", "Save the open note, or finish the review"],
	["Esc", "Close"],
	["?", "Show or hide this list"],
];

export interface ReaderSetup {
	session: DocReview["session"];
	result: SavedReview | undefined;
	/** The document a saved annotation without `file` belongs to. */
	defaultFile: string;
	/** The document on screen; empty when none is. */
	file: string;
	/** Its headings, for `J`/`K` and the outline. */
	headings: MarkdownBlock[];
	position: DocReview["position"];
	lineOf: DocReview["lineOf"];
	/** Opens `file` when it is not on screen; the reader then scrolls to the block. */
	open: (file: string) => void;
	/** Page keys, tried before the shared ones; returns true when it handled the key. */
	onKey?: (e: KeyboardEvent, s: State) => boolean;
	/** Fields the page adds to its submission. */
	extra?: () => Record<string, unknown>;
}

/**
 * The document reader both review pages share: annotation state, selection toolbar, popovers, highlights, sections
 * and scroll-spy, keys, and submission. A page supplies its documents through `setup` and lays out the rest.
 */
export function useReader(setup: ReaderSetup) {
	const { file, headings } = setup;
	// A page that cannot reach its session (a saved copy, or one whose session ended) reads, but takes no review.
	const { connected, agent, recheck } = useConnected(setup.session);
	const readOnly = !connected;
	const session = { ...setup.session, ask: setup.session.ask && agent };
	const [s, setState] = useState<State>(() => initial(setup.result, setup.defaultFile));
	const update = useCallback((change: (draft: State) => void) => {
		setState((previous) => {
			const draft = structuredClone(previous);
			change(draft);
			return draft;
		});
	}, []);
	const stateRef = useRef(s);
	stateRef.current = s;
	const setupRef = useRef(setup);
	setupRef.current = setup;
	const stage = useRef<HTMLElement>(null);
	const [current, setCurrent] = useState(headings[0]?.id);
	const [pending, setPending] = useState<{ block: string; annotation?: string } | null>(null);

	useEffect(() => {
		document.documentElement.dataset.theme = s.theme;
	}, [s.theme]);
	// Highlights are DOM decorations over the rendered blocks; reapply them after every render.
	useLayoutEffect(() => drawMarks(s, file));
	useEffect(() => {
		void drawDiagrams(s.theme);
	});

	const scrollTo = (el: Element | null, offset = 24) => {
		const box = stage.current;
		if (!el || !box) return;
		const to = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - offset;
		// Long jumps land at once; a smooth scroll across a long document only delays the answer.
		box.scrollTo({ top: to, behavior: Math.abs(to - box.scrollTop) > box.clientHeight * 2 ? "auto" : "smooth" });
	};
	const show = (block: string, annotation?: string) => {
		const marks = annotation ? document.querySelectorAll<HTMLElement>(`mark[data-an="${annotation}"]`) : [];
		const target = marks[0] ?? (block ? document.getElementById(block) : null);
		if (!target) return stage.current?.scrollTo({ top: 0 });
		scrollTo(target, annotation ? (stage.current?.clientHeight ?? 600) / 3 : 24);
		for (const m of marks) {
			m.classList.remove("flash");
			void m.offsetWidth;
			m.classList.add("flash");
		}
	};
	// A reveal in another document waits for that document to render.
	useEffect(() => {
		if (!pending) return;
		show(pending.block, pending.annotation);
		setPending(null);
	});
	const reveal: DocReview["reveal"] = (target, block, annotation) => {
		if (target === file) return show(block, annotation);
		setupRef.current.open(target);
		setPending({ block, annotation });
	};

	const savePop = () => {
		const pop = stateRef.current.pop;
		if (!pop) return;
		const text = (document.getElementById("pop-text") as HTMLTextAreaElement | null)?.value.trim() ?? "";
		const why = (document.getElementById("pop-why") as HTMLTextAreaElement | null)?.value.trim() || undefined;
		const added = pop.kind === "overall" ? undefined : composed(pop, text, why, file);
		update((d) => {
			d.pop = null;
			if (pop.kind === "overall") d.overall = text;
			else if (added) addAnnotation(d, added, setup.position);
		});
		if (added?.type !== "ask") return;
		void askAgent(session.token, file, added.spans, added.quote, text, recheck).then((answer) =>
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
			edits: Object.entries(st.edits).map(([key, after]) => ({ ...splitKey(key), after })),
			...setupRef.current.extra?.(),
		};
		const ok = await post("/result", session.token, body).then(
			(r) => r.ok,
			() => false,
		);
		if (!ok) recheck();
		update((d) => {
			d.submit = ok ? "sent" : "failed";
			if (ok) {
				d.verdict = verdict;
				d.modal = null;
			}
		});
	};

	const goTo = (id: string) => {
		setCurrent(id);
		scrollTo(document.getElementById(id));
	};
	const section = (step: number) => {
		const list = setupRef.current.headings;
		const i = list.findIndex((h) => h.id === current);
		const next = list[Math.max(0, Math.min(list.length - 1, i + step))];
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

	const review: DocReview = {
		session,
		s,
		update,
		readOnly,
		file,
		position: setup.position,
		lineOf: setup.lineOf,
		reveal,
		openPop,
		savePop,
		scrollTo,
		submit,
	};
	const keyState = useRef({ review, section });
	keyState.current = { review, section };

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
		const keyDown = (e: KeyboardEvent) => onKey(e, keyState.current.review, keyState.current.section, setupRef.current);
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

	const total = s.annotations.length + Object.keys(s.edits).length + (s.overall.trim() ? 1 : 0);
	return { review, s, update, stage, current, goTo, onScroll, onDocClick, total };
}

/** ⌘↵ saves or finishes, Esc closes, a letter over a selection starts a comment, J and K move between sections. */
function onKey(e: KeyboardEvent, review: DocReview, section: (step: number) => void, setup: ReaderSetup): void {
	const { s, update, readOnly } = review;
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
	} else if (typing || modified || s.modal || s.pop) {
		return;
	} else if (setup.onKey?.(e, s)) {
		e.preventDefault();
	} else if (e.key === "j" || e.key === "k") {
		e.preventDefault();
		section(e.key === "j" ? 1 : -1);
	}
}

/** The bar across the top: the 🥧, what is under review, and the review's controls. */
export function TopBar({
	title,
	path,
	total,
	children,
}: {
	title: string;
	path: string;
	total: number;
	children?: ReactNode;
}) {
	const { s, update, openPop, readOnly } = useDocReview();
	const verdictLabel = VERDICTS.find((v) => v.id === s.verdict)?.label ?? "Closed without a verdict";
	return (
		<header className="top">
			<span className="logo" aria-hidden="true">
				🥧
			</span>
			<span className="top-title">{title}</span>
			{children}
			<span className="path-chip">{path}</span>
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
	);
}

/** The saved copy's verdict line, and the agent's note until the reviewer hides it. */
export function Banner({ result, note }: { result?: SavedReview & { submittedAt: string }; note?: string }) {
	const { s, update } = useDocReview();
	return (
		<>
			{result ? (
				<div className="saved-banner">
					<Icon.check /> Reviewed {new Date(result.submittedAt).toLocaleString()} ·{" "}
					<b>{VERDICTS.find((v) => v.id === result.verdict)?.label ?? "Closed without a verdict"}</b>
					{result.overall ? <span className="saved-summary">“{result.overall}”</span> : null}
				</div>
			) : null}
			{note && !s.noteHidden ? (
				<div className="agent-line">
					<Icon.spark />
					<span>{note}</span>
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
		</>
	);
}

/** The toolbar, popovers, and sheets that float over every reader page. */
export function Floats({ keys, finish }: { keys: [string, string][]; finish?: ReactNode }) {
	const { readOnly, session, s } = useDocReview();
	return (
		<>
			{session.live && readOnly && s.submit !== "sent" ? (
				<div className="lost-note">
					The session that opened this page has ended, so this review can no longer be sent.
				</div>
			) : null}
			{readOnly ? null : <Toolbar />}
			<Composer />
			<AnnotationPop />
			<Finish>{finish}</Finish>
			<Keys keys={keys} />
		</>
	);
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CodeReviewPage, Verdict } from "../src/page-data";
import { type Review, ReviewContext } from "./context";
import { buildModel, type Model } from "./model";
import { ChapterPage, HunkPage, Modal, Overview, Rail, submitReview, TopBar, VERDICT_LABEL } from "./pages";
import {
	chapterStep,
	composeOn,
	goOverview,
	initialState,
	isOpen,
	markPageSeen,
	nextDecision,
	pageIsChapter,
	saveComposer,
	seenNext,
	seenPatternNext,
	setLens,
	type State,
	step,
	toResult,
} from "./state";
import { Icon } from "./ui";

type Change = (draft: State) => void;

/** The state change a key asks for in the current state, or undefined when the key does nothing here. */
function keyChange(key: string, shift: boolean, st: State, m: Model, readOnly: boolean): Change | undefined {
	const f = st.focus;
	switch (key) {
		case "j":
		case "k":
			return (d) => step(m, d, key === "j" ? 1 : -1);
		case "]":
		case "[":
			return (d) => chapterStep(m, d, key === "]" ? 1 : -1);
		case "Enter":
			if (readOnly) return undefined;
			return shift && f && m.patternOf[f] ? (d) => seenPatternNext(m, d, f) : (d) => seenNext(m, d);
		case "r":
			return pageIsChapter(st) && !readOnly ? (d) => markPageSeen(m, d) : undefined;
		case "x":
			return f && st.page !== "hunk"
				? (d) => {
						d.open[f] = !isOpen(m, d, f);
					}
				: undefined;
		case "X":
			return pageIsChapter(st)
				? (d) => {
						const ids = m.pageHunks(d.page);
						const anyOpen = ids.some((id) => isOpen(m, d, id));
						for (const id of ids) d.open[id] = !anyOpen;
					}
				: undefined;
		case "c":
			return f && st.page !== "overview" && !readOnly ? (d) => composeOn(m, d, f) : undefined;
		case "b": {
			if (st.page === "overview") return undefined;
			const chapter = f ? m.chapterOf[f] : undefined;
			const briefKey = st.page === "hunk" ? (chapter ? `h:${chapter.id}` : "") : `c:${st.page}`;
			if (!briefKey) return undefined;
			return (d) => {
				d.briefClosed[briefKey] = !(d.briefClosed[briefKey] ?? briefKey.startsWith("h:"));
			};
		}
		case "n":
			return (d) => {
				d.notesAll = !d.notesAll;
				d.noteOpen = {};
			};
		case "l":
			return (d) => setLens(m, d, d.lens === "story" ? "attention" : "story");
		case "o":
			return goOverview;
		case "q":
			return (d) => nextDecision(m, d, "question");
		case "Q":
			return (d) => nextDecision(m, d, "judgment");
		case "?":
			return (d) => {
				d.modal = "keys";
			};
		default:
			return undefined;
	}
}

export function CodeReview({ page }: { page: CodeReviewPage }) {
	const m = useMemo(() => buildModel(page), [page]);
	const readOnly = !page.session.live;
	const [s, setState] = useState<State>(() => initialState(page.result));
	const update = useCallback((change: (draft: State) => void) => {
		setState((previous) => {
			const draft = structuredClone(previous);
			change(draft);
			return draft;
		});
	}, []);
	const stateRef = useRef(s);
	stateRef.current = s;

	const submit = useCallback(
		async (verdict: Verdict) => {
			update((d) => {
				d.submit = "sending";
			});
			const ok = await submitReview(page.session.token, toResult(m, stateRef.current, verdict));
			update((d) => {
				d.submit = ok ? "sent" : "failed";
				if (ok) {
					d.verdict = verdict;
					d.modal = null;
				}
			});
		},
		[m, page.session.token, update],
	);

	useEffect(() => {
		document.documentElement.dataset.theme = s.theme;
	}, [s.theme]);

	// Apply a requested scroll once, after the page it targets has rendered.
	const appliedScroll = useRef(0);
	useLayoutEffect(() => {
		if (s.scrollSeq === appliedScroll.current) return;
		appliedScroll.current = s.scrollSeq;
		// The rail first: a later scrollIntoView elsewhere would cancel the stage's smooth scroll.
		document.querySelector(".r-ch.on, .r-hunk.on")?.scrollIntoView({ block: "nearest" });
		const stage = document.getElementById("stage");
		if (!stage || !s.scrollTo) return;
		if (s.scrollTo === "top") {
			stage.scrollTo({ top: 0 });
			return;
		}
		const element = s.scrollTo.startsWith("el:");
		const target = document.getElementById(element ? s.scrollTo.slice(3) : `hunk-${s.scrollTo}`);
		if (!target) return;
		const top = target.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop;
		// Hunks align under the sticky file header; revealed elements sit a third of the way down.
		const to = element ? top - stage.clientHeight / 3 : top - 48;
		// Long jumps land at once; a smooth scroll across thousands of lines only delays the answer.
		const far = Math.abs(to - stage.scrollTop) > stage.clientHeight * 2;
		stage.scrollTo({ top: to, behavior: far ? "auto" : "smooth" });
	}, [s.scrollSeq, s.scrollTo]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const st = stateRef.current;
			const target = e.target as HTMLElement;
			const typing = !!target.closest?.("textarea, input");
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				if (readOnly) return;
				if (target.id === "composer-text") update(saveComposer);
				else if (st.modal === "verdict" && st.verdict && st.verdict !== "dismissed") void submit(st.verdict);
				else
					update((d) => {
						d.modal = "verdict";
					});
				return;
			}
			if (e.key === "Escape") {
				if (st.composer || st.modal)
					update((d) => {
						if (d.composer) d.composer = null;
						else d.modal = null;
					});
				return;
			}
			if (typing || e.metaKey || e.ctrlKey || e.altKey || st.modal) return;
			const k = e.key;
			if (k === " " || k === "d" || k === "u") {
				const stage = document.getElementById("stage");
				const up = (k === " " && e.shiftKey) || k === "u";
				stage?.scrollBy({ top: (up ? -1 : 1) * stage.clientHeight * (k === " " ? 0.85 : 0.5), behavior: "smooth" });
				e.preventDefault();
				return;
			}
			const change = keyChange(k, e.shiftKey, st, m, readOnly);
			if (!change) return;
			e.preventDefault();
			update(change);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [m, readOnly, submit, update]);

	const review: Review = { m, s, update, readOnly };
	const body = s.page === "overview" ? <Overview /> : s.page === "hunk" ? <HunkPage /> : <ChapterPage />;
	return (
		<ReviewContext.Provider value={review}>
			<div className="app">
				<TopBar />
				<Rail />
				<main className="stage" id="stage">
					<div className="stage-in">
						{readOnly && page.result ? (
							<div className="saved-banner">
								<Icon.check /> Reviewed {new Date(page.result.submittedAt).toLocaleString()} ·{" "}
								<b>{VERDICT_LABEL[page.result.verdict]}</b>
								{page.result.summary ? <span className="saved-summary">“{page.result.summary}”</span> : null}
							</div>
						) : null}
						{body}
					</div>
				</main>
			</div>
			<Modal onSubmit={(verdict) => void submit(verdict)} />
			{s.submit === "sent" && !readOnly ? (
				<div className="overlay sent">
					<div className="modal sent-card">
						<div className="sent-ic">
							<Icon.check />
						</div>
						<h3>{s.verdict === "dismissed" ? "Closed without a verdict" : "Review sent to the agent"}</h3>
						<p>You can close this tab. A copy of this page, with your review, is saved for later.</p>
					</div>
				</div>
			) : null}
		</ReviewContext.Provider>
	);
}

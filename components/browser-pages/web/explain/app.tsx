import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ExplainChangePage, ExplainPart } from "../../src/page-data";
import { useConnected } from "../connected";
import { drawDiagrams } from "../markdown/mermaid";
import { Icon, Kbd } from "../ui";
import { Launcher, Sidebar, useTutor } from "./chat";
import { AlsoChanged, Parts, Quiz } from "./parts";

const KEYS: [string, string][] = [
	["J / K", "Next / previous part"],
	["Q", "Go to the quiz"],
	["A – D", "Answer the question in view"],
	["/", "Talk it through, while the agent is reachable"],
	["T", "Light or dark"],
	["⌘P", "Print a clean copy"],
	["?", "Show or hide this list"],
];

const words = (parts: ExplainPart[]) =>
	parts.reduce(
		(n, p) => n + ("block" in p ? p.block.raw.split(/\s+/).length : "code" in p ? p.code.rows.length * 4 : 0),
		0,
	);

/** Opens with the stage scrolled so `el` sits near the top; long jumps land at once. */
function scrollStage(stage: HTMLElement | null, el: Element | null) {
	if (!stage || !el) return;
	const to = el.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - 24;
	stage.scrollTo({ top: to, behavior: Math.abs(to - stage.scrollTop) > stage.clientHeight * 2 ? "auto" : "smooth" });
}

function Section({
	id,
	num,
	title,
	hint,
	children,
}: {
	id: string;
	num: string;
	title: string;
	hint: string;
	children: ReactNode;
}) {
	return (
		<section className="ex-sec" id={id}>
			<div className="ex-sec-h">
				<span className="num">{num}</span>
				<h2>{title}</h2>
				<span className="t">{hint}</span>
			</div>
			{children}
		</section>
	);
}

export function ExplainChange({ page }: { page: ExplainChangePage }) {
	const [theme, setTheme] = useState<"light" | "dark">(() =>
		typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
	);
	const [answers, setAnswers] = useState<Record<number, number>>({});
	const [keys, setKeys] = useState(false);
	const [current, setCurrent] = useState("top");
	const [progress, setProgress] = useState(0);
	const [focus, setFocus] = useState<number | undefined>(undefined);
	const [selection, setSelection] = useState<{ x: number; y: number; text: string; src: string } | null>(null);
	const { agent, recheck } = useConnected(page.session);
	const ai = agent && page.session.ask;
	const tutor = useTutor(page.session.token, recheck);
	const stage = useRef<HTMLElement>(null);
	const live = useRef({ answers, asked: tutor.asked });
	live.current = { answers, asked: tutor.asked };

	const figures = useMemo(() => {
		const all = [
			page.summary,
			page.primer ?? [],
			page.background,
			page.intuition,
			...page.steps.map((s) => s.parts),
		].flat();
		return new Map(all.filter((p) => "figure" in p).map((p, i) => [p, i + 1] as const));
	}, [page]);
	const minutes = useMemo(() => {
		const all = [page.summary, page.background, page.intuition, ...page.steps.map((s) => s.parts)].flat();
		return Math.max(1, Math.round(words(all) / 230));
	}, [page]);
	const anchors = [
		"top",
		"background",
		"intuition",
		"walkthrough",
		...page.steps.map((_, i) => `step-${i}`),
		"also",
		"quiz",
	];
	const right = page.quiz.filter((q, i) => answers[i] === q.answer).length;
	const answered = Object.keys(answers).length;
	const totals = page.stats.reduce((t, f) => ({ add: t.add + f.add, del: t.del + f.del }), { add: 0, del: 0 });

	// A layout effect runs before every passive one, so figures read the new theme's colours when they rebuild.
	useLayoutEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);
	useEffect(() => {
		void drawDiagrams(theme);
	}, [theme]);

	// What the reader found hard goes back to the agent, once they leave the page.
	useEffect(() => {
		if (!ai) return;
		const send = () => {
			if (document.visibilityState !== "hidden") return;
			const { answers, asked } = live.current;
			const body = { answers: Object.entries(answers).map(([q, chosen]) => ({ question: Number(q), chosen })), asked };
			void fetch("/note", {
				method: "POST",
				keepalive: true,
				headers: { "content-type": "application/json", "x-page-token": page.session.token },
				body: JSON.stringify(body),
			}).catch(() => {});
		};
		document.addEventListener("visibilitychange", send);
		addEventListener("pagehide", send);
		return () => {
			document.removeEventListener("visibilitychange", send);
			removeEventListener("pagehide", send);
		};
	}, [ai, page.session.token]);

	const goto = (id: string) => scrollStage(stage.current, document.getElementById(id));
	const answer = (q: number, k: number) => setAnswers((a) => (a[q] === undefined ? { ...a, [q]: k } : a));
	const retry = () => {
		setAnswers((a) => Object.fromEntries(Object.entries(a).filter(([q, k]) => page.quiz[Number(q)].answer === k)));
		const first = page.quiz.findIndex((q, i) => answers[i] !== q.answer);
		goto(`q-${first}`);
	};
	const talk = (q: number) =>
		tutor.begin(`Talk me through question ${q + 1}. I chose “${page.quiz[q].options[answers[q]]}”.`, {
			kind: "talk",
			question: q,
			choice: answers[q],
		});
	const check = (i: number) =>
		tutor.begin(`Check my understanding of step ${i + 1}: ${page.steps[i].title}.`, { kind: "check", step: i });
	const cite = (kind: string, n: number) =>
		goto(kind === "Step" ? `step-${n - 1}` : kind === "Question" ? `q-${n - 1}` : `figure-${n}`);

	const onScroll = () => {
		const box = stage.current;
		if (!box) return;
		const line = box.getBoundingClientRect().top + 120;
		setCurrent(
			anchors.filter((id) => (document.getElementById(id)?.getBoundingClientRect().top ?? 1e9) < line).at(-1) ?? "top",
		);
		setProgress(box.scrollTop / Math.max(1, box.scrollHeight - box.clientHeight));
		const inView = [...document.querySelectorAll<HTMLElement>(".ex-q")].find((q) => {
			const r = q.getBoundingClientRect();
			return r.bottom > line && r.top < innerHeight - 80;
		});
		setFocus(inView ? Number(inView.dataset.q) : undefined);
		setSelection(null);
	};

	const keyState = useRef({ anchors, current, focus, ai, tutor, answer, goto });
	keyState.current = { anchors, current, focus, ai, tutor, answer, goto };
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const s = keyState.current;
			if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest?.("textarea, input")) return;
			const k = e.key.toLowerCase();
			if (k === "escape") {
				setKeys(false);
				setSelection(null);
				s.tutor.setOpen(false);
			} else if (k === "?") setKeys((v) => !v);
			else if (k === "/" && s.ai) {
				e.preventDefault();
				s.tutor.setOpen(true);
			} else if (k === "t") setTheme((t) => (t === "dark" ? "light" : "dark"));
			else if (k === "q") s.goto("quiz");
			else if (k === "j" || k === "k") {
				const i = s.anchors.indexOf(s.current);
				s.goto(s.anchors[Math.max(0, Math.min(s.anchors.length - 1, i + (k === "j" ? 1 : -1)))]);
			} else if ("abcd".includes(k) && k.length === 1 && s.focus !== undefined) s.answer(s.focus, "abcd".indexOf(k));
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	const onMouseUp = (e: React.MouseEvent) => {
		if (!ai || (e.target as Element).closest("button, iframe, .ex-q")) return;
		setTimeout(() => {
			const sel = getSelection();
			const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
			if (!sel || sel.isCollapsed || !text) return setSelection(null);
			const where = sel.anchorNode?.parentElement?.closest<HTMLElement>(".ex-step, .ex-sec, .ex-tldr");
			const src = where?.classList.contains("ex-step")
				? `Step ${Number(where.id.slice(5)) + 1}`
				: (where?.querySelector("h2")?.textContent ?? "In one minute");
			const r = sel.getRangeAt(0).getBoundingClientRect();
			setSelection({
				text: text.length > 400 ? `${text.slice(0, 397)}…` : text,
				src,
				x: Math.min(Math.max(12, r.left + r.width / 2 - 140), innerWidth - 300),
				y: Math.max(60, r.top - 46),
			});
		});
	};
	const fromSelection = (kind: "ask" | "quiz") => {
		if (!selection) return;
		const quote = { src: selection.src, text: selection.text };
		tutor.begin(
			kind === "ask" ? "What is this doing, and why?" : "Quiz me on this.",
			{ kind, quote: selection.text },
			quote,
		);
		getSelection()?.removeAllRanges();
		setSelection(null);
	};

	const toc = (id: string, num: ReactNode, label: string, cls = "", tail: ReactNode = null) => (
		<button type="button" key={id} className={`ex-toc-i ${cls} ${current === id ? "on" : ""}`} onClick={() => goto(id)}>
			<span className="num">{num}</span>
			<span>{label}</span>
			{tail}
		</button>
	);
	const pass = answered === page.quiz.length && right === page.quiz.length;
	const chatOpen = ai && tutor.open;

	return (
		<div className="app md-app ex-app">
			<header className="top">
				<span className="logo" aria-hidden="true">
					🥧
				</span>
				<span className="ex-kind">Explanation</span>
				<span className="top-title">{page.title}</span>
				<span className="ex-ref">{page.ref}</span>
				<span className="ex-stat">
					{page.stats.length} files <span className="a">+{totals.add}</span> <span className="d">−{totals.del}</span>
				</span>
				<span className="sp" />
				<button type="button" className={`ex-quizpill ${pass ? "pass" : ""}`} onClick={() => goto("quiz")}>
					Quiz{" "}
					<span className="n">
						{right}/{page.quiz.length}
					</span>
				</button>
				{ai ? (
					<button
						type="button"
						className={`btn ghost ex-chatbtn ${chatOpen ? "on" : ""}`}
						onClick={() => tutor.setOpen(!tutor.open)}
					>
						<Icon.bubble /> Talk it through <Kbd>/</Kbd>
					</button>
				) : null}
				<button
					type="button"
					className="icon-btn"
					title="Theme"
					onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
				>
					{theme === "dark" ? <Icon.sun /> : <Icon.moon />}
				</button>
				<button type="button" className="icon-btn" title="Print" onClick={() => print()}>
					<Icon.print />
				</button>
				<button type="button" className="icon-btn" title="Keyboard (?)" onClick={() => setKeys(!keys)}>
					?
				</button>
				<div className="ex-progress" style={{ width: `${Math.min(100, progress * 100)}%` }} />
			</header>
			<div className={`ex-body ${chatOpen ? "chat-open" : ""}`}>
				<nav className="ex-toc">
					<div className="ex-toc-k">Contents</div>
					{toc("top", "·", "In one minute")}
					{toc("background", "1", "Background")}
					{toc("intuition", "2", "Intuition")}
					{toc("walkthrough", "3", "Walkthrough")}
					{page.steps.map((s, i) => toc(`step-${i}`, i + 1, s.title, "step"))}
					{toc("also", "4", "Also changed")}
					{toc(
						"quiz",
						"5",
						"Quiz",
						"",
						<span className={`tail ${pass ? "pass" : ""}`}>
							{answered ? `${right}/${page.quiz.length}` : page.quiz.length}
						</span>,
					)}
					<div className="ex-toc-keys">
						<span>
							<Kbd>J</Kbd> <Kbd>K</Kbd> next / previous part
						</span>
						<span>
							<Kbd>Q</Kbd> quiz · <Kbd>A</Kbd>–<Kbd>D</Kbd> answer
						</span>
					</div>
				</nav>
				<main className="stage" ref={stage} onScroll={onScroll} onMouseUp={onMouseUp}>
					<article className="ex-article">
						<div id="top" className="ex-eyebrow">
							Explanation of {page.ref}
							{page.subject ? ` · ${page.subject}` : ""}
						</div>
						<h1>{page.title}</h1>
						<div className="ex-meta">
							<span>
								<b>{minutes} min</b> read
							</span>
							<span>
								<b>{page.steps.length}</b> steps
							</span>
							<span>
								<b>{page.quiz.length}</b> questions
							</span>
							<span>
								<b>{page.covered.length}</b> of {page.stats.length} files walked through
							</span>
						</div>
						<div className="ex-tldr">
							<div className="ex-tldr-k">In one minute</div>
							<Parts parts={page.summary} figures={figures} theme={theme} />
						</div>
						<div className="ex-route">
							{(
								[
									["background", "Background", ""],
									["intuition", "Intuition", ""],
									["walkthrough", "Walkthrough", `${page.steps.length} steps`],
									["quiz", "Quiz", `${page.quiz.length} questions`],
								] as const
							).map(([id, label, hint], i) => (
								<button type="button" key={id} onClick={() => goto(id)}>
									<span className="num">{i + 1}</span>
									{label}
									{hint ? <span className="t">{hint}</span> : null}
								</button>
							))}
						</div>
						<Section id="background" num="01" title="Background" hint="What was there before">
							{page.primer ? (
								<details className="ex-primer">
									<summary>
										<b>New to this part of the system?</b> Start with the primer.
									</summary>
									<Parts parts={page.primer} figures={figures} theme={theme} />
								</details>
							) : null}
							<Parts parts={page.background} figures={figures} theme={theme} />
						</Section>
						<Section id="intuition" num="02" title="Intuition" hint="The idea, before the code">
							<Parts parts={page.intuition} figures={figures} theme={theme} />
						</Section>
						<Section id="walkthrough" num="03" title="Walkthrough" hint={`${page.steps.length} steps`}>
							{page.steps.map((s, i) => (
								<div className="ex-step" id={`step-${i}`} key={s.title}>
									<div className="ex-step-k">
										Step {i + 1} of {page.steps.length}
									</div>
									<h3>{s.title}</h3>
									<Parts parts={s.parts} figures={figures} theme={theme} />
									{ai ? (
										<button type="button" className="ex-check" onClick={() => check(i)}>
											<Icon.bubble />
											<span>
												<b>Check my understanding</b> of this step
											</span>
										</button>
									) : null}
								</div>
							))}
						</Section>
						<Section id="also" num="04" title="Also changed" hint="Not walked through">
							<AlsoChanged page={page} />
						</Section>
						<Section id="quiz" num="05" title="Quiz" hint="Answer from memory">
							<p className="ex-lead">
								Five questions about the substance of the change. Each answer explains itself. Pass before you share the
								change, or before you build on it.
							</p>
							<Quiz
								page={page}
								answers={answers}
								focus={focus}
								onAnswer={answer}
								onRetry={retry}
								onTalk={ai ? talk : undefined}
							/>
						</Section>
					</article>
				</main>
				{chatOpen ? <Sidebar tutor={tutor} onCite={cite} /> : null}
			</div>
			{ai && !chatOpen ? <Launcher onOpen={() => tutor.setOpen(true)} /> : null}
			{ai && selection ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: keeps the selection while a toolbar button is pressed.
				<div
					className="ex-tbar"
					style={{ left: selection.x, top: selection.y }}
					onMouseDown={(e) => e.preventDefault()}
				>
					<button type="button" onClick={() => fromSelection("ask")}>
						<Icon.bubble /> Ask about this
					</button>
					<button type="button" onClick={() => fromSelection("quiz")}>
						<Icon.spark /> Quiz me on this
					</button>
				</div>
			) : null}
			{keys ? (
				// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Escape closes the sheet.
				<div className="overlay" onClick={() => setKeys(false)}>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the panel only stops the overlay's click. */}
					<div className="modal" onClick={(e) => e.stopPropagation()}>
						<div className="modal-h">
							<h3>Keyboard</h3>
						</div>
						<div className="keys">
							{KEYS.map(([k, v]) => (
								<div key={k}>
									<span>{v}</span>
									<kbd>{k}</kbd>
								</div>
							))}
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

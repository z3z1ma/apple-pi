import { memo, useEffect, useRef, useState } from "react";

import type { CodeExcerpt, ExplainChangePage, ExplainPart } from "../../src/page-data";
import { lineHtml, renderBlock } from "../markdown/render";
import { inlineMarkdown, Kbd } from "../ui";

const Block = memo(function Block({ html }: { html: string }) {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: renderBlock escapes all document text and drops unsafe URLs.
	return <div className="ex-block" dangerouslySetInnerHTML={{ __html: html }} />;
});

/** Agent-written text that is not a block: escaped first, then given inline Markdown. */
export function Inline({ text, as: Tag = "span" }: { text: string; as?: "span" | "p" }) {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: inlineMarkdown escapes the text before adding tags.
	return <Tag dangerouslySetInnerHTML={{ __html: inlineMarkdown(text) }} />;
}

export function CodeCard({ code }: { code: CodeExcerpt }) {
	const [all, setAll] = useState(false);
	const plain = code.status === "new" || code.status === "unchanged";
	const added = code.rows.filter((r) => r.t === "+").length;
	const removed = code.rows.filter((r) => r.t === "-").length;
	const clip = !all && code.rows.length > 26;
	const badge = {
		new: <span className="badge new">new file</span>,
		deleted: <span className="badge deleted">deleted file</span>,
		unchanged: <span className="badge">unchanged</span>,
		changed: (
			<span className="badge changed">
				+{added} −{removed}
			</span>
		),
	}[code.status];
	return (
		<figure className={`ex-code ${clip ? "clip" : ""}`}>
			<figcaption className="ex-code-h">
				<span className="path">{code.path}</span>
				<span className="lines">
					lines {code.from}–{code.to}
				</span>
				{badge}
			</figcaption>
			<div className="ex-code-b">
				{code.rows.map((r, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
					<div key={i} className={`ex-cl ${plain ? "" : r.t === "+" ? "add" : r.t === "-" ? "del" : ""}`}>
						<span className="n">{r.n ?? ""}</span>
						<span className="m">{plain || r.t === " " ? "" : r.t}</span>
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: lineHtml escapes the text and admits only colour tokens. */}
						<span className="s" dangerouslySetInnerHTML={{ __html: lineHtml(r.s) || " " }} />
					</div>
				))}
			</div>
			{clip ? (
				<button type="button" className="ex-more" onClick={() => setAll(true)}>
					Show all {code.rows.length} lines
				</button>
			) : null}
		</figure>
	);
}

/** Figures are agent-written HTML. They run sandboxed, with no network and no access to this page. */
const FIGURE_POLICY =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
const TOKENS = [
	"--font-ui",
	"--font-mono",
	"--bg",
	"--surface",
	"--surface-2",
	"--surface-3",
	"--ink",
	"--ink-2",
	"--ink-3",
	"--ink-4",
	"--line",
	"--line-2",
	"--accent",
	"--accent-bg",
	"--agent",
	"--agent-bg",
	"--pass",
	"--fail",
	"--shadow",
	"--add-ink",
	"--del-ink",
	"--code-bg",
];

function figureDocument(html: string, theme: string): string {
	const css = getComputedStyle(document.documentElement);
	const vars = TOKENS.map((v) => `${v}:${css.getPropertyValue(v)}`).join(";");
	return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FIGURE_POLICY}"><style>:root{${vars};color-scheme:${theme}}*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--ink);font:14px/1.5 var(--font-ui)}</style></head><body>${html}<script>new ResizeObserver(()=>parent.postMessage({figureHeight:document.documentElement.scrollHeight},"*")).observe(document.body)</script></body></html>`;
}

export function Figure({ n, caption, html, theme }: { n: number; caption: string; html: string; theme: string }) {
	const frame = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(320);
	const [doc, setDoc] = useState("");
	// Built after the theme reaches the page, so the figure takes the colours the reader sees.
	useEffect(() => setDoc(figureDocument(html, theme)), [html, theme]);
	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (e.source === frame.current?.contentWindow && typeof e.data?.figureHeight === "number")
				setHeight(e.data.figureHeight);
		};
		addEventListener("message", onMessage);
		return () => removeEventListener("message", onMessage);
	}, []);
	return (
		<figure className="ex-figure" id={`figure-${n}`}>
			<div className="ex-fig-frame">
				<iframe ref={frame} sandbox="allow-scripts" srcDoc={doc} title={`Figure ${n}`} style={{ height }} />
			</div>
			<figcaption>
				<b>Figure {n}.</b>
				<span>{caption}</span>
				{/<script/i.test(html) ? <span className="live">Interactive</span> : null}
			</figcaption>
		</figure>
	);
}

export function Parts({
	parts,
	figures,
	theme,
}: {
	parts: ExplainPart[];
	figures: Map<ExplainPart, number>;
	theme: string;
}) {
	return (
		<div className="doc ex-prose">
			{parts.map((p, i) =>
				"block" in p ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts are positional.
					<Block key={i} html={renderBlock(p.block)} />
				) : "code" in p ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts are positional.
					<CodeCard key={i} code={p.code} />
				) : "figure" in p ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts are positional.
					<Figure key={i} n={figures.get(p) ?? 0} caption={p.figure.caption} html={p.figure.html} theme={theme} />
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts are positional.
					<div key={i} className="ex-missing">
						An excerpt could not be shown: <Inline text={p.missing} />
					</div>
				),
			)}
		</div>
	);
}

const KINDS: [string, (path: string) => boolean][] = [
	[
		"Code the walkthrough did not cover",
		(p) => /\.(ts|tsx|js|jsx|py|go|rs|java|kt|rb|swift|c|cc|cpp|h)$/.test(p) && !/test|spec/.test(p),
	],
	["Tests", (p) => /test|spec/.test(p)],
	["Markup and styles", (p) => /\.(css|scss|html)$/.test(p) && !/\bdist\//.test(p)],
	["Built files", (p) => /\bdist\//.test(p)],
	["Docs, config, and everything else", () => true],
];
/** A long path keeps its first folder and its last two parts. */
const shortPath = (p: string) => {
	const parts = p.split("/");
	return parts.length > 4 && p.length > 60 ? `${parts[0]}/…/${parts.slice(-2).join("/")}` : p;
};

export function AlsoChanged({ page }: { page: ExplainChangePage }) {
	const covered = new Set(page.covered);
	const rest = page.stats.filter((f) => !covered.has(f.path));
	const max = Math.max(1, ...rest.map((f) => f.add + f.del));
	const used = new Set<string>();
	const groups = KINDS.map(([name, test]) => {
		const files = rest.filter((f) => !used.has(f.path) && test(f.path));
		for (const f of files) used.add(f.path);
		return [name, files] as const;
	}).filter(([, files]) => files.length);
	return (
		<>
			<div className="ex-covered">
				The walkthrough shows{" "}
				<b>
					{page.covered.length} of {page.stats.length} files
				</b>
				.{" "}
				{rest.length
					? `Everything else that ${page.ref} changed is listed here, so nothing changed without being mentioned.`
					: "It covers every changed file."}
			</div>
			<div className="ex-also">
				{groups.map(([name, files]) => (
					<div key={name}>
						<div className="ex-group-h">
							{name}
							<span className="count">{files.length}</span>
						</div>
						{files.map((f) => (
							<div className="ex-frow" key={f.path}>
								<span className="p" title={f.path}>
									{shortPath(f.path)}
								</span>
								<span className="c">
									<span className="a">+{f.add}</span> <span className="d">−{f.del}</span>
								</span>
								<span className="ex-bar">
									<i className="a" style={{ width: `${(100 * f.add) / max}%` }} />
									<i className="d" style={{ width: `${(100 * f.del) / max}%` }} />
								</span>
							</div>
						))}
					</div>
				))}
			</div>
		</>
	);
}

export function Quiz({
	page,
	answers,
	focus,
	onAnswer,
	onRetry,
	onTalk,
}: {
	page: ExplainChangePage;
	answers: Record<number, number>;
	focus: number | undefined;
	onAnswer: (q: number, k: number) => void;
	onRetry: () => void;
	onTalk?: (q: number) => void;
}) {
	const right = page.quiz.filter((q, i) => answers[i] === q.answer).length;
	const all = Object.keys(answers).length === page.quiz.length;
	return (
		<>
			{page.quiz.map((q, i) => {
				const a = answers[i];
				const done = a !== undefined;
				return (
					<div className={`ex-q ${focus === i ? "focus" : ""}`} id={`q-${i}`} data-q={i} key={q.question}>
						<div className="ex-q-h">
							Question {i + 1} of {page.quiz.length}
							<span className="sp" />
							{done ? (
								a === q.answer ? (
									<span className="ok">✓ Right</span>
								) : (
									<span className="no">✗ Not quite</span>
								)
							) : null}
						</div>
						<Inline as="p" text={q.question} />
						<div className="ex-opts">
							{q.options.map((o, k) => (
								<button
									type="button"
									key={o}
									className={`ex-opt ${!done ? "" : k === q.answer ? "right" : k === a ? "wrong" : "dim"}`}
									disabled={done}
									onClick={() => onAnswer(i, k)}
								>
									<Kbd>{"ABCD"[k]}</Kbd>
									<Inline text={o} />
									{done && k === q.answer ? (
										<span className="mark">✓</span>
									) : done && k === a ? (
										<span className="mark">✗</span>
									) : null}
								</button>
							))}
						</div>
						{done ? (
							<div className="ex-why">
								<Inline text={q.why} />
								{a !== q.answer && onTalk ? (
									<div className="ex-why-act">
										<button type="button" className="btn sm ex-talk" onClick={() => onTalk(i)}>
											Talk it through
										</button>
										<span>The tutor starts from your answer and asks until it clicks.</span>
									</div>
								) : null}
							</div>
						) : null}
					</div>
				);
			})}
			{all ? (
				<div className={`ex-score ${right === page.quiz.length ? "pass" : ""}`}>
					<span className="big">
						{right}/{page.quiz.length}
					</span>
					<span className="msg">
						{right === page.quiz.length
							? "You understand this change. It is ready to share."
							: "Read the steps the misses point to, then try the quiz again."}
					</span>
					<span className="sp" />
					{right === page.quiz.length ? null : (
						<button type="button" className="btn" onClick={onRetry}>
							Try again
						</button>
					)}
				</div>
			) : null}
		</>
	);
}

import type { CSSProperties, ReactNode } from "react";

import type { Attention, Segment } from "../src/page-data";

const escapeHtml = (s: string) =>
	s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** Inline Markdown only: code, bold, italics. Text is escaped first. */
export function inlineMarkdown(text: string): string {
	return escapeHtml(text)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>");
}

export const plain = (text: string) => text.replace(/[`*]/g, "");

/** Block Markdown for agent answers: fenced code, lists, headings as bold lines, and paragraphs. Escapes first. */
export function blockMarkdown(text: string): string {
	const out: string[] = [];
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line.startsWith("```")) {
			const code: string[] = [];
			for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
			i++;
			out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
		} else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
			const ordered = /^\s*\d+\./.test(line);
			const items: string[] = [];
			for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++)
				items.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`);
			out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
		} else if (line.trim()) {
			const para: string[] = [];
			for (; i < lines.length && lines[i].trim() && !/^(```|\s*([-*]|\d+\.)\s+)/.test(lines[i]); i++)
				para.push(lines[i].replace(/^#+\s*/, ""));
			const heading = /^#+\s/.test(line);
			out.push(
				heading
					? `<p><strong>${inlineMarkdown(para.join(" "))}</strong></p>`
					: `<p>${inlineMarkdown(para.join(" "))}</p>`,
			);
		} else i++;
	}
	return out.join("");
}

export function Answer({ text }: { text: string }) {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: blockMarkdown escapes the text before adding tags.
	return <div className="answer" dangerouslySetInnerHTML={{ __html: blockMarkdown(text) }} />;
}

export function Md({
	text,
	as: Tag = "span",
	className,
}: {
	text: string;
	as?: "span" | "p" | "div";
	className?: string;
}) {
	return (
		// biome-ignore lint/security/noDangerouslySetInnerHtml: inlineMarkdown escapes the text before adding tags.
		<Tag className={className ? `md ${className}` : "md"} dangerouslySetInnerHTML={{ __html: inlineMarkdown(text) }} />
	);
}

const icon = (d: ReactNode, fill = false) => (
	<svg className={fill ? "ic ic-fill" : "ic"} viewBox="0 0 16 16" aria-hidden="true">
		{d}
	</svg>
);

export const Icon = {
	check: () => icon(<path d="M3.5 8.5l2.8 2.8L12.5 5" />),
	spark: () => icon(<path d="M8 1.2l1.7 5.1 5.1 1.7-5.1 1.7L8 14.8l-1.7-5.1L1.2 8l5.1-1.7z" />, true),
	warn: () =>
		icon(
			<>
				<path d="M8 2.3l6.3 11.1H1.7z" />
				<path d="M8 6.6v3.1M8 11.6v.1" />
			</>,
		),
	chevL: () => icon(<path d="M10 3.5L5.5 8l4.5 4.5" />),
	arrowR: () => icon(<path d="M3 8h10M9 4l4 4-4 4" />),
	circle: () => icon(<circle cx="8" cy="8" r="5.2" />),
	x: () => icon(<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />),
	pencil: () => icon(<path d="M10.8 2.7l2.5 2.5L6 12.5l-3 .5.5-3z" />),
	print: () =>
		icon(
			<>
				<path d="M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2" />
				<path d="M4.5 9.5h7v4h-7z" />
			</>,
		),
	strike: () =>
		icon(
			<path d="M3 8h10M5.5 5.5c0-1.4 1.2-2.3 2.6-2.3 1.2 0 2.2.5 2.6 1.4M10.5 10.5c0 1.4-1.2 2.3-2.6 2.3-1.3 0-2.4-.6-2.8-1.6" />,
		),
	bubble: () =>
		icon(
			<path d="M2.6 4.3c0-1 .8-1.8 1.8-1.8h7.2c1 0 1.8.8 1.8 1.8v5c0 1-.8 1.8-1.8 1.8H7.2l-3.1 2.4v-2.4h0c-.9-.1-1.5-.8-1.5-1.8z" />,
		),
	moon: () => icon(<path d="M13.2 9.6A5.6 5.6 0 016.4 2.8a5.6 5.6 0 106.8 6.8z" />),
	sun: () =>
		icon(
			<>
				<circle cx="8" cy="8" r="3" />
				<path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M3 13l1.1-1.1M11.9 4.1L13 3" />
			</>,
		),
	question: () =>
		icon(
			<>
				<circle cx="8" cy="8" r="6.2" />
				<path d="M6.3 6.2a1.8 1.8 0 113 1.4c-.7.5-1.3.9-1.3 1.8M8 11.4v.1" />
			</>,
		),
	send: () =>
		icon(
			<>
				<path d="M2.2 7.7L13.6 2.6 9.8 13.8 7.6 9.1z" />
				<path d="M7.6 9.1l6-6.5" />
			</>,
		),
	chevron: (closed: boolean) => (
		<svg className={closed ? "ic chev closed" : "ic chev"} viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4 6l4 4 4-4" />
		</svg>
	),
};

export const Diamond = () => <span className="di">◆</span>;

export function AttBars({ att }: { att: Attention }) {
	return (
		<span className={`att-bars att-${att}`}>
			<i />
			<i />
			<i />
		</span>
	);
}

export function Kbd({ children }: { children: ReactNode }) {
	return <kbd>{children}</kbd>;
}

function SegmentText({ seg }: { seg: Segment }) {
	if (!seg.c && !seg.d) return <>{seg.t}</>;
	return (
		<span className="tk" style={{ "--c": seg.c, "--d": seg.d } as CSSProperties}>
			{seg.t}
		</span>
	);
}

/** One line of highlighted code; consecutive word-level marks share one `<mark>`. */
export function CodeLine({ segments }: { segments: Segment[] }) {
	const groups: { mark: boolean; segs: Segment[] }[] = [];
	for (const seg of segments) {
		const last = groups[groups.length - 1];
		if (last && last.mark === !!seg.m) last.segs.push(seg);
		else groups.push({ mark: !!seg.m, segs: [seg] });
	}
	return (
		<>
			{groups.map((g, i) => {
				// biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond their position.
				const content = g.segs.map((seg, k) => <SegmentText key={k} seg={seg} />);
				// biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond their position.
				return g.mark ? <mark key={i}>{content}</mark> : <span key={i}>{content}</span>;
			})}
			{segments.length === 0 || segments.every((s) => !s.t) ? " " : null}
		</>
	);
}

export const pad = (n: number) => String(n).padStart(2, "0");
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const dirName = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

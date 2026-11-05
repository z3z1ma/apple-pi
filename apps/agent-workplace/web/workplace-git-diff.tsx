import { useEffect } from "react";
import { Icon } from "./workplace-icon.js";

export type DiffView = { title: string; detail: string; text: string };

type Line = {
	kind: "meta" | "hunk" | "added" | "removed" | "context" | "note";
	text: string;
	old?: number;
	new?: number;
};

export function diffLines(text: string): Line[] {
	const lines: Line[] = [];
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;
	for (const raw of text.replace(/\n$/, "").split("\n")) {
		const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
		if (hunk) {
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[2]);
			inHunk = true;
			lines.push({ kind: "hunk", text: raw });
		} else if (!inHunk || raw.startsWith("diff --git")) {
			inHunk = false;
			if (!/^(diff --git|index |--- |\+\+\+ )/.test(raw)) lines.push({ kind: "meta", text: raw });
		} else if (raw.startsWith("+")) lines.push({ kind: "added", text: raw.slice(1), new: newLine++ });
		else if (raw.startsWith("-")) lines.push({ kind: "removed", text: raw.slice(1), old: oldLine++ });
		else if (raw.startsWith("\\")) lines.push({ kind: "note", text: raw });
		else lines.push({ kind: "context", text: raw.slice(1), old: oldLine++, new: newLine++ });
	}
	return lines;
}

export function GitDiff({ diff, onClose }: { diff: DiffView; onClose(): void }) {
	useEffect(() => {
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.defaultPrevented) onClose();
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [onClose]);
	const lines = diffLines(diff.text);
	const added = lines.filter((line) => line.kind === "added").length;
	const removed = lines.filter((line) => line.kind === "removed").length;
	return (
		<section className="wp-gitx-diff" aria-label={`Diff of ${diff.title}`}>
			<header>
				<button type="button" className="wp-gitx-back" onClick={onClose} title="Back to the graph (Esc)">
					<Icon name="back" />
					Graph
				</button>
				<div className="wp-gitx-diff-title">
					<strong title={diff.title}>{diff.title}</strong>
					<span>{diff.detail}</span>
				</div>
				<span className="wp-gitx-diff-stat">
					<span className="wp-gitx-added">+{added}</span> <span className="wp-gitx-removed">-{removed}</span>
				</span>
			</header>
			{diff.text ? (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: the diff scrolls with the keyboard.
				<div className="wp-gitx-diff-body" tabIndex={0}>
					{lines.map((line, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: diff lines are stateless text with positional identity.
						<div key={index} className={`wp-gitx-line is-${line.kind}`}>
							<span className="wp-gitx-number">{line.old ?? ""}</span>
							<span className="wp-gitx-number">{line.new ?? ""}</span>
							<span className="wp-gitx-sign">{line.kind === "added" ? "+" : line.kind === "removed" ? "-" : ""}</span>
							<code>{line.text || " "}</code>
						</div>
					))}
				</div>
			) : (
				<p className="wp-gitx-empty">No text changes. The file may be binary or only its mode changed.</p>
			)}
		</section>
	);
}

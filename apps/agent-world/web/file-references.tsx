import { createContext, type MouseEvent, useContext, useEffect, useMemo, useState } from "react";
import {
	type FileReferenceCandidate,
	type FileReferenceTarget,
	fileReferenceCandidate,
	fileReferenceTokens,
	resolvedFileReference,
} from "./file-reference-paths.js";
import "./file-references.css";

export type { FileReferenceTarget } from "./file-reference-paths.js";
export const FileReferenceNavigation = createContext<((target: FileReferenceTarget) => void) | undefined>(undefined);
export const FileReferenceCwd = createContext<string | undefined>(undefined);

type Prepared = { html: string; candidates: FileReferenceCandidate[] };

function prepare(html: string): Prepared {
	const template = document.createElement("template");
	template.innerHTML = html;
	const candidates: FileReferenceCandidate[] = [];
	const placeholder = (text: string, value = text) => {
		const span = document.createElement("span");
		span.textContent = text;
		const candidate = fileReferenceCandidate(value);
		if (candidate) {
			span.dataset.wpFile = String(candidates.length);
			candidates.push(candidate);
		}
		return span;
	};
	for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>("a[data-file]")) {
		const span = placeholder(anchor.textContent ?? "", anchor.getAttribute("href") ?? "");
		span.dataset.wpFileContent = "";
		span.replaceChildren(...anchor.childNodes);
		anchor.replaceWith(span);
	}
	for (const code of template.content.querySelectorAll("code")) {
		if (code.closest("a, pre, [data-wp-file-content]")) continue;
		const text = code.textContent ?? "";
		if (!text || /[\r\n]/.test(text)) continue;
		const span = placeholder(text);
		span.dataset.wpFileContent = "";
		code.replaceChildren(span);
	}
	const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	while (walker.nextNode()) nodes.push(walker.currentNode as Text);
	for (const node of nodes) {
		if (node.parentElement?.closest("a, [data-wp-file-content], .aw-md-link-dead, .aw-md-image")) continue;
		const tokens = fileReferenceTokens(node.data);
		if (!tokens.length) continue;
		const parts: Node[] = [];
		let start = 0;
		for (const token of tokens) {
			parts.push(document.createTextNode(node.data.slice(start, token.start)), placeholder(token.text));
			start = token.end;
		}
		parts.push(document.createTextNode(node.data.slice(start)));
		node.replaceWith(...parts);
	}
	return { html: template.innerHTML, candidates };
}

export function useFileReferenceHtml(html: string) {
	const navigate = useContext(FileReferenceNavigation);
	const cwd = useContext(FileReferenceCwd);
	const enabled = navigate !== undefined;
	const prepared = useMemo(() => (enabled ? prepare(html) : { html, candidates: [] }), [html, enabled]);
	const paths = JSON.stringify([
		...new Set(prepared.candidates.flatMap((item) => [item.literal, ...(item.path ? [item.path] : [])])),
	]);
	const [resolved, setResolved] = useState<{ key: string; files: Map<string, FileReferenceTarget> }>();
	const [failure, setFailure] = useState<{ key: string; reason: string }>();
	const key = JSON.stringify([cwd, paths]);
	useEffect(() => {
		if (!enabled || paths === "[]") return;
		let live = true;
		void Promise.resolve()
			.then(() =>
				live
					? window.agentWorld.workspace.resolvePaths({ paths: JSON.parse(paths) as string[], ...(cwd ? { cwd } : {}) })
					: undefined,
			)
			.then((result) => {
				if (!live || !result) return;
				if (result.ok)
					setResolved({
						key,
						files: new Map(result.files.map((file) => [file.candidate, { root: file.root, path: file.path }])),
					});
				else setFailure({ key, reason: result.reason });
			})
			.catch((reason) => {
				if (live) setFailure({ key, reason: String(reason) });
			});
		return () => {
			live = false;
		};
	}, [enabled, cwd, paths, key]);
	const targets = useMemo(
		() =>
			prepared.candidates.map((candidate) =>
				resolved?.key === key ? resolvedFileReference(candidate, resolved.files) : undefined,
			),
		[prepared, resolved, key],
	);
	const decorated = useMemo(() => {
		if (!enabled) return html;
		const template = document.createElement("template");
		template.innerHTML = prepared.html;
		for (const span of template.content.querySelectorAll<HTMLElement>("[data-wp-file]")) {
			const index = Number(span.dataset.wpFile);
			const target = targets[index];
			if (!target) continue;
			const anchor = document.createElement("a");
			anchor.href = "#";
			anchor.className = "wp-file-reference";
			anchor.dataset.wpFile = String(index);
			anchor.setAttribute("aria-label", `Open file: ${span.textContent}`);
			anchor.title = `${target.root}/${target.path}${target.line ? `:${target.line}${target.column ? `:${target.column}` : ""}` : ""}`;
			anchor.replaceChildren(...span.childNodes);
			span.replaceWith(anchor);
		}
		return template.innerHTML;
	}, [enabled, html, prepared, targets]);
	const follow = (event: MouseEvent): boolean => {
		const anchor =
			event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a.wp-file-reference") : null;
		if (!anchor || !navigate || event.button > 1) return false;
		event.preventDefault();
		event.stopPropagation();
		const target = targets[Number(anchor.dataset.wpFile)];
		if (target) navigate(target);
		return true;
	};
	return { html: decorated, follow, error: failure?.key === key ? failure.reason : undefined };
}

export function FileReferenceText({ text }: { text: string }) {
	const plain = useMemo(() => {
		const span = document.createElement("span");
		span.textContent = text;
		return span.innerHTML;
	}, [text]);
	const references = useFileReferenceHtml(plain);
	return (
		<>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: delegates native anchor activation */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: native anchors emit clicks for Enter */}
			<span
				onClick={references.follow}
				onAuxClick={references.follow}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: escaped text with controlled local-file anchors
				dangerouslySetInnerHTML={{ __html: references.html }}
			/>
			{references.error && <span role="status">File links unavailable: {references.error}</span>}
		</>
	);
}

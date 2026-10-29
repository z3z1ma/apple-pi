// Jira's and Confluence's HTML shown in a place's panel: sanitised by `safeHtml` (or plain text as paragraphs), with
// its links opening in the system browser rather than in the world's window.
import { useMemo } from "react";
import { atlassian } from "./atlassian-state.js";
import { safeHtml, textHtml } from "./rich-text.js";

/** A click on a link inside sanitised HTML: open it outside, never in the window. */
function openLinkIn(event: React.MouseEvent, onLink?: (url: string) => void) {
	const link = event.target instanceof Element ? event.target.closest("a.aw-rich-link") : null;
	if (!(link instanceof HTMLAnchorElement)) return;
	event.preventDefault();
	if (event.type === "click" || (event as React.MouseEvent).button === 1) {
		if (onLink) onLink(link.href);
		else void atlassian.openLink(link.href);
	}
}

export function RichView({
	html,
	text,
	base,
	className,
	empty,
	onLink,
}: {
	html: string | null | undefined;
	text?: string;
	/** The Atlassian site, so relative links lead there. */
	base?: string;
	className?: string;
	/** What shows when there is nothing. */
	empty?: string;
	onLink?: (url: string) => void;
}) {
	const safe = useMemo(
		() => (html?.trim() ? safeHtml(html, base) : text?.trim() ? textHtml(text) : ""),
		[html, text, base],
	);
	if (!safe) return empty ? <p className="aw-rich-empty">{empty}</p> : null;
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: links inside are real links; Enter on one reaches onClick
		// biome-ignore lint/a11y/noStaticElementInteractions: the clicks caught here are the links' own
		<div
			className={`aw-rich${className ? ` ${className}` : ""}`}
			onClick={(event) => openLinkIn(event, onLink)}
			onAuxClick={(event) => openLinkIn(event, onLink)}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: rebuilt from an allow-list by safeHtml / textHtml
			dangerouslySetInnerHTML={{ __html: safe }}
		/>
	);
}

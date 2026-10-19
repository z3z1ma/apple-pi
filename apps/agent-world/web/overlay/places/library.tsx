// The library's panels (ticket 26), in the theme's words: the librarian searches all of Confluence and keeps the pages
// read lately; a page reads in the panel (its HTML sanitised, styled by the theme as a book page, a document, or a
// notebook) or opens in the browser; and an agent can be asked to summarise or update it (an instruction naming the
// page; nothing is written to Confluence).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConfluencePage, ConfluencePageRef } from "../../../src/integrations.js";
import type { WorldSnapshot } from "../../../src/world.js";
import { portraitOf } from "../../looks.js";
import { say } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import { ago } from "../interface/model.js";
import { atlassian } from "./atlassian-state.js";
import { HandOver } from "./hand-over.js";
import { PlaceDialog } from "./place-dialog.js";
import { RichView } from "./rich-view.js";

const failure = (error: unknown) => String((error as Error)?.message ?? error);
const edited = (iso: string | null | undefined) => {
	const text = iso ? ago(Date.parse(iso)) : "";
	return !text ? "" : text === "now" ? "edited just now" : `edited ${text} ago`;
};

/** The last search, kept while the panel goes to a page and back. */
let lastSearch = "";

export function LibraryPanels({ world }: { world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(atlassian.subscribe, atlassian.get);
	const label = useTheme()?.labels.library ?? "Library";
	const panel = state.panel;
	if (panel?.kind !== "librarian" && panel?.kind !== "page") return null;
	return (
		<PlaceDialog
			key={state.opening}
			label={panel.kind === "page" ? (panel.title ?? "A page") : label}
			className={`aw-library${panel.kind === "page" ? " aw-library-page" : ""}`}
			onClose={() => atlassian.close()}
		>
			{panel.kind === "librarian" ? (
				<Librarian
					onOpen={(page) => atlassian.show({ kind: "page", id: page.id, title: page.title, from: "librarian" })}
				/>
			) : (
				<PageReader
					key={panel.id}
					id={panel.id}
					title={panel.title}
					world={world}
					onBack={panel.from === "librarian" ? () => atlassian.show({ kind: "librarian" }) : undefined}
				/>
			)}
		</PlaceDialog>
	);
}

function Librarian({ onOpen }: { onOpen: (page: ConfluencePageRef) => void }) {
	const state = useSyncExternalStore(atlassian.subscribe, atlassian.get);
	const theme = useTheme();
	const [query, setQuery] = useState(lastSearch);
	const [found, setFound] = useState<{ pages?: ConfluencePageRef[]; reason?: string; loading?: boolean }>();
	const signedOut = state.signedIn === null;
	const recent = state.recent.state === "ready" ? state.recent.items : undefined;

	useEffect(() => {
		void atlassian.loadRecent();
	}, []);

	const searched = useRef(0);
	const search = async (text: string) => {
		const words = text.trim();
		lastSearch = text;
		const turn = ++searched.current;
		if (!words) return setFound(undefined);
		setFound((now) => ({ pages: now?.pages, loading: true }));
		try {
			const result = await atlassian.get().api?.confluenceSearch?.(words);
			if (turn !== searched.current) return;
			if (!result) return setFound({ reason: "Agent World is not connected." });
			setFound(result.ok ? { pages: result.pages } : { reason: result.reason });
		} catch (error) {
			if (turn === searched.current) setFound({ reason: failure(error) });
		}
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: search is redefined each render; the query drives it
	useEffect(() => {
		const timer = setTimeout(() => void search(query), query.trim().length >= 2 ? 450 : 0);
		return () => clearTimeout(timer);
	}, [query]);

	const portrait = theme ? portraitOf(theme, "librarian", recent?.length ? "happy" : "neutral") : undefined;
	const searching = !!query.trim();
	return (
		<>
			<header className="aw-place-head">
				<div className="aw-place-portrait">
					{portrait && <img src={portrait} alt={theme?.labels.librarian} draggable={false} />}
				</div>
				<div className="aw-place-heading">
					<h2>{theme?.labels.library}</h2>
					<p className="aw-place-says">
						&ldquo;{say(theme, signedOut ? "library-signed-out" : "library-greeting")}&rdquo;
					</p>
				</div>
				{signedOut && (
					<button
						type="button"
						className="aw-button aw-button-strong aw-place-act"
						onClick={() => atlassian.askSignIn()}
					>
						Sign in from Settings
					</button>
				)}
			</header>
			{!signedOut && (
				<form
					className="aw-quest-search"
					onSubmit={(event) => {
						event.preventDefault();
						void search(query);
					}}
				>
					<input
						type="search"
						className="aw-place-search"
						placeholder={say(theme, "library-search")}
						aria-label="Search all of Confluence"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</form>
			)}
			{!signedOut && (
				<div className="aw-place-scroll">
					{searching ? (
						<section className="aw-place-section" aria-label="Search results">
							<h3 className="aw-quest-section">
								<span>Every page matching &ldquo;{query.trim()}&rdquo;</span>
								{found?.pages && <small>{found.pages.length}</small>}
								{found?.loading && <span className="aw-progress aw-progress-sending">Searching&hellip;</span>}
							</h3>
							{found?.reason && (
								<p className="aw-progress aw-progress-failed" role="alert">
									{found.reason}
								</p>
							)}
							{found?.pages && found.pages.length > 0 && (
								<ul className="aw-place-list aw-page-list" aria-label="Search results">
									{found.pages.map((page) => (
										<PageRow key={page.id} page={page} onOpen={() => onOpen(page)} />
									))}
								</ul>
							)}
							{found?.pages?.length === 0 && <p className="aw-place-empty">No page matches that.</p>}
						</section>
					) : (
						<section className="aw-place-section" aria-label={say(theme, "library-recent")}>
							<h3 className="aw-quest-section">
								<span>{say(theme, "library-recent")}</span>
								{recent && recent.length > 0 && <small>{recent.length}</small>}
							</h3>
							{recent && recent.length > 0 ? (
								<ul className="aw-place-list aw-page-list" aria-label={say(theme, "library-recent")}>
									{recent.map((page) => (
										<PageRow key={page.id} page={page} read={page.openedAt} onOpen={() => onOpen(page)} />
									))}
								</ul>
							) : (
								<p className="aw-place-empty">{say(theme, "library-recent-empty")}</p>
							)}
						</section>
					)}
				</div>
			)}
		</>
	);
}

function PageRow({ page, read, onOpen }: { page: ConfluencePageRef; read?: number; onOpen: () => void }) {
	const opened = read ? ago(read) : "";
	return (
		<li className="aw-page-row">
			<button type="button" className="aw-page-main" onClick={onOpen} title={`Read \u201c${page.title}\u201d`}>
				<span className="aw-page-mark" aria-hidden="true" />
				<span className="aw-page-text">
					<span className="aw-page-title">{page.title}</span>
					{page.excerpt && <span className="aw-page-excerpt">{page.excerpt}</span>}
					<span className="aw-page-meta">
						{page.space && <span className="aw-page-space">{page.space}</span>}
						{opened ? (
							<span>{opened === "now" ? "read just now" : `read ${opened} ago`}</span>
						) : (
							page.lastModified && <span>{edited(page.lastModified)}</span>
						)}
					</span>
				</span>
			</button>
		</li>
	);
}

/** A page read in the panel, with Open in the browser and Ask an agent. */
function PageReader({
	id,
	title,
	world,
	onBack,
}: {
	id: string;
	title?: string;
	world: WorldSnapshot | undefined;
	onBack?: () => void;
}) {
	const state = useSyncExternalStore(atlassian.subscribe, atlassian.get);
	const [page, setPage] = useState<ConfluencePage>();
	const [reason, setReason] = useState<string>();
	const [signedOut, setSignedOut] = useState(false);
	const [asking, setAsking] = useState(false);

	useEffect(() => {
		let live = true;
		void (async () => {
			try {
				const api = atlassian.get().api;
				if (!api?.confluencePage) throw new Error("Agent World is not connected.");
				const got = await api.confluencePage(id);
				if (!live) return;
				if (got.ok) {
					setPage(got.page);
					// It joins the shelf of pages read lately.
					void atlassian.loadRecent();
				} else {
					setReason(got.reason);
					setSignedOut(got.signIn === "atlassian");
				}
			} catch (error) {
				if (live) setReason(failure(error));
			}
		})();
		return () => {
			live = false;
		};
	}, [id]);

	const ref = page?.page;
	const name = ref?.title ?? title ?? "";
	return (
		<>
			<header className="aw-place-head aw-page-head">
				<span className="aw-page-mark aw-page-mark-large" aria-hidden="true" />
				<div className="aw-place-heading">
					<p className="aw-page-where">
						{onBack && (
							<button type="button" className="aw-back" onClick={onBack} title="Back to the library">
								<span aria-hidden="true">&larr;</span> Back
							</button>
						)}
						{ref?.space && <span className="aw-page-space">{ref.space}</span>}
						{ref?.lastModified && <span>{edited(ref.lastModified)}</span>}
					</p>
					<h2>{name || (reason ? "This page could not be read" : "Fetching the page\u2026")}</h2>
				</div>
			</header>
			{ref && (
				<div className="aw-issue-actions" role="toolbar" aria-label="What to do with it">
					<button type="button" className="aw-button" onClick={() => void atlassian.openLink(ref.url)}>
						Open in the browser
					</button>
					<button
						type="button"
						className="aw-button aw-button-strong"
						aria-pressed={asking}
						onClick={() => setAsking((now) => !now)}
					>
						Ask an agent about it
					</button>
				</div>
			)}
			{ref && asking && (
				<HandOver
					world={world}
					item={{ kind: "page", id: ref.id, title: ref.title, url: ref.url }}
					asks={[
						{ ask: "summarise", label: "Summarise it" },
						{ ask: "update", label: "Update it" },
					]}
					title={`Ask an agent about \u201c${ref.title}\u201d`}
					hint="It reaches the agent as an instruction naming this page. Nothing is written to Confluence from here."
					onClose={() => setAsking(false)}
				/>
			)}
			{reason && !page && (
				<div className="aw-issue-failed">
					<p className="aw-progress aw-progress-failed" role="alert">
						{reason}
					</p>
					{signedOut && (
						<button type="button" className="aw-button aw-button-strong" onClick={() => atlassian.askSignIn()}>
							Sign in from Settings
						</button>
					)}
				</div>
			)}
			{!page && !reason && <p className="aw-progress aw-progress-sending aw-page-loading">Fetching the page&hellip;</p>}
			{page && (
				<div className="aw-place-scroll aw-page-scroll">
					<article className="aw-page-sheet" aria-label={name}>
						<RichView
							html={page.html}
							base={state.signedIn?.site}
							className="aw-page-body"
							empty="This page is empty."
						/>
					</article>
				</div>
			)}
		</>
	);
}

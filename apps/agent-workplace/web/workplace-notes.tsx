import { useEffect, useState } from "react";
import type { NotesRead, OrgNote, WorldSnapshot } from "../src/world.js";
import { Markdown } from "./overlay/conversation/transcript.js";
import { Icon } from "./workplace-icon.js";
import "./workplace-outside.css";

const api = window.agentWorkplace;

const when = (at: number) =>
	new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The organization's notes: what the scout and the desk learned, and the threads they found to be connected. */
export function NotesView({ world }: { world: WorldSnapshot }) {
	const [words, setWords] = useState("");
	const [read, setRead] = useState<NotesRead>();
	const [open, setOpen] = useState<string>();
	// biome-ignore lint/correctness/useExhaustiveDependencies: a snapshot can carry a newly written note; reading again is one query.
	useEffect(() => {
		let current = true;
		const timer = setTimeout(
			() => void api.readNotes({ words, limit: 200 }).then((next) => current && setRead(next)),
			words ? 200 : 0,
		);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [words, world]);
	const nameOf = (id: string) =>
		world.characters.find((person) => person.id === id)?.name ??
		world.dormant?.find((person) => person.id === id)?.name ??
		id;
	return (
		<section className="wp-activity-view wp-notes-view" aria-label="Notes">
			<header className="wp-conversation-header">
				<div>
					<h1>Notes</h1>
					<p>What the organization learned, and the threads it found to be about the same thing.</p>
				</div>
				<label className="wp-find wp-threads-find">
					<Icon name="search" />
					<input
						aria-label="Search notes"
						placeholder="Search notes"
						value={words}
						onChange={(event) => setWords(event.target.value)}
					/>
				</label>
			</header>
			<div className="wp-activity-scroll">
				{read && !read.ok && <p className="wp-activity-calm">{read.reason}</p>}
				{read?.ok && !read.notes.length && (
					<p className="wp-activity-calm">
						{words ? "No note mentions that." : "No notes yet. The scout writes them as it explores."}
					</p>
				)}
				{read?.ok && read.notes.length > 0 && (
					<ul className="wp-notes-list">
						{read.notes.map((note) => (
							<NoteRow
								key={note.id}
								note={note}
								open={open === note.id}
								toggle={() => setOpen(open === note.id ? undefined : note.id)}
								author={nameOf(note.by)}
							/>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

function NoteRow({ note, open, toggle, author }: { note: OrgNote; open: boolean; toggle: () => void; author: string }) {
	const urls = note.refs.filter((ref) => /^https?:\/\//.test(ref));
	return (
		<li data-open={open}>
			<button type="button" aria-expanded={open} onClick={toggle}>
				<span className="wp-outside-tile" aria-hidden="true">
					<Icon name={note.refs.length > 1 ? "threads" : "file"} />
				</span>
				<span className="wp-activity-body">
					<span className="wp-activity-kind">
						{note.refs.length > 1 ? `Connects ${note.refs.length}` : "Note"}
						{note.topics.length > 0 && <span className="wp-outside-more"> &middot; {note.topics.join(", ")}</span>}
					</span>
					<strong>{note.title}</strong>
					{!open && <span className="wp-activity-text">{note.body.replace(/\s+/g, " ")}</span>}
				</span>
				<time title={when(note.updatedAt)}>
					{author} &middot; {when(note.updatedAt)}
				</time>
			</button>
			{open && (
				<div className="wp-note-body">
					<Markdown text={note.body} />
					{urls.length > 0 && (
						<ul className="wp-note-refs">
							{urls.map((url) => (
								<li key={url}>
									<button type="button" onClick={() => void api.openLink(url)}>
										{url}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
		</li>
	);
}

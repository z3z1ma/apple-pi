// The headquarters' notepad: the operator's free notes, kept in the coordinator's `NOTES.md` and saved as he types. Two
// actions reach agents: ask one to write an update where the cursor is, and send the selected text to one.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Character, WorldSnapshot } from "../../../src/world.js";
import {
	insertMarker,
	type NotepadApi,
	notepad,
	removeMarker,
	selectionMessage,
	updateMarker,
	updateRequest,
} from "./notepad-state.js";
import { PlaceDialog } from "./place-dialog.js";
import { type Progress, placeActions } from "./place-panels.js";
import "./notepad.css";
import "./recruit.css";

/** How long typing pauses before the notes are saved. */
const SAVE_PAUSE_MS = 500;

export function NotepadPanels({ world }: { world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(notepad.subscribe, notepad.get);
	if (!state.open || !state.api) return null;
	return <Notepad key={state.opening} coordinator={state.open} api={state.api} world={world} />;
}

type Loaded = { state: "loading" } | { state: "failed"; reason: string } | { state: "ready"; path: string };

/** What the notes' saving shows: saved, saving, a save that failed, or the file changed on disk under unsaved edits. */
type Saving = { state: "saved" | "saving" } | { state: "failed"; reason: string } | { state: "changed"; disk: string };

/** A request to an agent being written under the notes: an update at a marker, or the selected text. */
type Request = { kind: "update"; marker: string } | { kind: "selection"; text: string };

function Notepad({
	coordinator,
	api,
	world,
}: {
	coordinator: { id: string; name: string };
	api: NotepadApi;
	world: WorldSnapshot | undefined;
}) {
	const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
	const [text, setText] = useState("");
	const [saving, setSaving] = useState<Saving>({ state: "saved" });
	const [selection, setSelection] = useState("");
	const [request, setRequest] = useState<Request>();
	const field = useRef<HTMLTextAreaElement>(null);
	// The file's text as last read or saved; edits are saved against it, so a change on disk is never overwritten.
	const base = useRef("");
	const latest = useRef("");
	latest.current = text;
	const inFlight = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const conflicted = useRef(false);
	conflicted.current = saving.state === "changed";

	const save = async () => {
		clearTimeout(timer.current);
		if (inFlight.current || conflicted.current || latest.current === base.current) return;
		inFlight.current = true;
		const sent = latest.current;
		setSaving({ state: "saving" });
		const result = await api.saveNotepad(coordinator.id, sent, base.current);
		inFlight.current = false;
		if (result.ok) {
			base.current = sent;
			if (latest.current !== sent) return void save();
			setSaving({ state: "saved" });
		} else if (result.changed !== undefined) setSaving({ state: "changed", disk: result.changed });
		else setSaving({ state: "failed", reason: result.reason });
	};
	const edit = (next: string) => {
		setText(next);
		latest.current = next;
		clearTimeout(timer.current);
		timer.current = setTimeout(() => void save(), SAVE_PAUSE_MS);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: read once per opening; later changes arrive by `onNotepad`
	useEffect(() => {
		let live = true;
		const stop = api.onNotepad((change) => {
			if (change.coordinatorId !== coordinator.id) return;
			if (latest.current === base.current) {
				base.current = change.text;
				latest.current = change.text;
				setText(change.text);
			} else setSaving({ state: "changed", disk: change.text });
		});
		void api.openNotepad(coordinator.id).then((read) => {
			if (!live) return;
			if (!read.ok) return setLoaded({ state: "failed", reason: read.reason });
			base.current = read.text;
			latest.current = read.text;
			setText(read.text);
			setLoaded({ state: "ready", path: read.path });
		});
		return () => {
			live = false;
			stop();
			// Closing keeps what was typed: the last edits are saved at once.
			void save();
		};
	}, []);

	const resolve = (keep: "mine" | "theirs", disk: string) => {
		base.current = disk;
		if (keep === "theirs") {
			latest.current = disk;
			setText(disk);
		}
		setSaving({ state: "saved" });
		conflicted.current = false;
		if (keep === "mine") void save();
	};

	const readSelection = () => {
		const area = field.current;
		setSelection(area ? area.value.slice(area.selectionStart, area.selectionEnd) : "");
	};

	const askForUpdate = () => {
		const area = field.current;
		const marker = updateMarker(Math.random().toString(36).slice(2, 8));
		edit(insertMarker(text, area?.selectionStart ?? text.length, marker));
		void save();
		setRequest({ kind: "update", marker });
	};
	const cancelRequest = () => {
		if (request?.kind === "update") {
			edit(removeMarker(latest.current, request.marker));
			void save();
		}
		setRequest(undefined);
	};

	const path = loaded.state === "ready" ? loaded.path : "";
	const title = `${coordinator.name}'s notes`;
	return (
		<PlaceDialog label={title} className="aw-notepad" onClose={() => notepad.close()}>
			<header className="aw-place-head aw-notepad-head">
				<div className="aw-place-heading">
					<h2>{title}</h2>
					<p className="aw-place-says">{path || "NOTES.md in the coordinator's directory"}</p>
				</div>
			</header>
			{loaded.state === "failed" ? (
				<p className="aw-progress aw-progress-failed" role="status">
					{loaded.reason}
				</p>
			) : (
				<>
					<textarea
						ref={field}
						className="aw-letter-body aw-notepad-text"
						aria-label="Notes"
						value={text}
						disabled={loaded.state !== "ready"}
						placeholder="Type anything. It is saved as you type."
						spellCheck
						onChange={(event) => edit(event.target.value)}
						onSelect={readSelection}
						onBlur={() => void save()}
					/>
					<SaveLine saving={saving} resolve={resolve} />
					{request ? (
						<AgentRequest
							request={request}
							path={path}
							coordinator={coordinator}
							world={world}
							onDone={() => setRequest(undefined)}
							onCancel={cancelRequest}
						/>
					) : (
						<div className="aw-letter-actions aw-notepad-actions">
							<button
								type="button"
								className="aw-button"
								disabled={!selection.trim()}
								title={selection.trim() ? undefined : "Select some text in the notes first"}
								onClick={() => setRequest({ kind: "selection", text: selection })}
							>
								Send selection to an agent
							</button>
							<button
								type="button"
								className="aw-button aw-button-strong"
								disabled={loaded.state !== "ready"}
								onClick={askForUpdate}
							>
								Ask an agent to add an update here
							</button>
						</div>
					)}
				</>
			)}
		</PlaceDialog>
	);
}

function SaveLine({ saving, resolve }: { saving: Saving; resolve: (keep: "mine" | "theirs", disk: string) => void }) {
	if (saving.state === "changed")
		return (
			<div className="aw-notepad-changed" role="alert">
				<span>The notes changed on disk while you were typing.</span>
				<button type="button" className="aw-button" onClick={() => resolve("theirs", saving.disk)}>
					Load the file
				</button>
				<button type="button" className="aw-button" onClick={() => resolve("mine", saving.disk)}>
					Keep mine
				</button>
			</div>
		);
	const text = saving.state === "failed" ? saving.reason : saving.state === "saving" ? "Saving\u2026" : "Saved";
	return (
		<span className={`aw-notepad-saved aw-notepad-${saving.state}`} role="status">
			{text}
		</span>
	);
}

/** Who can be asked: the awake agents, the coordinator first. */
const agentsOf = (world: WorldSnapshot | undefined, coordinatorId: string): Character[] =>
	[...(world?.characters ?? [])].sort(
		(a, b) => Number(b.id === coordinatorId) - Number(a.id === coordinatorId) || a.name.localeCompare(b.name),
	);

function AgentRequest({
	request,
	path,
	coordinator,
	world,
	onDone,
	onCancel,
}: {
	request: Request;
	path: string;
	coordinator: { id: string; name: string };
	world: WorldSnapshot | undefined;
	onDone: () => void;
	onCancel: () => void;
}) {
	const agents = agentsOf(world, coordinator.id);
	const [to, setTo] = useState(agents[0]?.id ?? coordinator.id);
	const [words, setWords] = useState("");
	const [progress, setProgress] = useState<Progress>();
	const agent = agents.find((a) => a.id === to);
	const isUpdate = request.kind === "update";
	const ready = !!agent && (!isUpdate || words.trim() !== "") && progress?.state !== "sending";

	const send = async () => {
		if (!ready || !agent) return;
		setProgress({ state: "sending", text: `Sending to ${agent.name}\u2026` });
		const body = isUpdate ? updateRequest(path, request.marker, words) : selectionMessage(path, request.text, words);
		setProgress(await placeActions.sendMail({ id: agent.id, name: agent.name, asleep: false }, body));
	};

	if (progress && progress.state !== "sending")
		return (
			<div className="aw-letter aw-letter-sent aw-notepad-request">
				<span className={`aw-progress aw-progress-${progress.state}`} role="status">
					{progress.text}
				</span>
				<div className="aw-letter-actions">
					{progress.state === "done" ? (
						<button type="button" className="aw-button aw-button-strong" onClick={onDone}>
							Done
						</button>
					) : (
						<>
							<button type="button" className="aw-button" onClick={onCancel}>
								Cancel
							</button>
							<button type="button" className="aw-button aw-button-strong" onClick={() => setProgress(undefined)}>
								Try again
							</button>
						</>
					)}
				</div>
			</div>
		);
	return (
		<form
			className="aw-letter aw-recruit-form aw-notepad-request"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<label className="aw-letter-to">
				<span>Agent</span>
				<select aria-label="Agent" value={to} onChange={(event) => setTo(event.target.value)}>
					{agents.map((a) => (
						<option key={a.id} value={a.id}>
							{a.name}
							{a.id === coordinator.id ? " (coordinator)" : ""}
						</option>
					))}
				</select>
			</label>
			<label className="aw-letter-to aw-recruit-brief">
				<span>{isUpdate ? "Update" : "Note"}</span>
				<textarea
					aria-label={isUpdate ? "What to write" : "Note to the agent"}
					className="aw-letter-body"
					rows={3}
					value={words}
					placeholder={
						isUpdate
							? "What should it write here? For example: what each worker is doing now."
							: "Optional: what to do with it."
					}
					onChange={(event) => setWords(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
					}}
				/>
			</label>
			{isUpdate && <p className="aw-letter-note">It replaces the marker line in the notes with its update.</p>}
			<div className="aw-letter-actions">
				<button type="button" className="aw-button" onClick={onCancel}>
					Cancel
				</button>
				<button type="submit" className="aw-button aw-button-strong" disabled={!ready}>
					{isUpdate ? "Ask" : "Send"}
				</button>
			</div>
			{progress?.state === "sending" && (
				<span className="aw-progress aw-progress-sending" role="status">
					{progress.text}
				</span>
			)}
		</form>
	);
}

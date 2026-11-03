import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasList, CanvasSummary, WorldSnapshot } from "../src/world.js";
import { Icon } from "./workplace-icon.js";
import "./workplace-canvases.css";

const api = window.agentWorkplace;

const PAGE = 200;

const SAVE_AFTER_MS = 700;

const ago = (at: number) => {
	const minutes = Math.round((Date.now() - at) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours}h ago` : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const BLOCKS: { label: string; hint: string; run: (editor: Editor) => void }[] = [
	{ label: "Text", hint: "Plain paragraph", run: (editor) => editor.chain().focus().setParagraph().run() },
	{ label: "Heading 1", hint: "#", run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run() },
	{ label: "Heading 2", hint: "##", run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run() },
	{ label: "Heading 3", hint: "###", run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run() },
	{ label: "To-do list", hint: "[ ]", run: (editor) => editor.chain().focus().toggleTaskList().run() },
	{ label: "Bulleted list", hint: "-", run: (editor) => editor.chain().focus().toggleBulletList().run() },
	{ label: "Numbered list", hint: "1.", run: (editor) => editor.chain().focus().toggleOrderedList().run() },
	{ label: "Quote", hint: ">", run: (editor) => editor.chain().focus().toggleBlockquote().run() },
	{ label: "Code", hint: "```", run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
	{ label: "Divider", hint: "---", run: (editor) => editor.chain().focus().setHorizontalRule().run() },
];

export function CanvasesView({ world }: { world: WorldSnapshot }) {
	const [words, setWords] = useState("");
	const [list, setList] = useState<CanvasList>();
	const [open, setOpen] = useState<string>();
	const [refresh, setRefresh] = useState(0);
	const [shown, setShown] = useState(PAGE);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a snapshot or a save can change the list; reading it again is one query.
	useEffect(() => {
		let current = true;
		const timer = setTimeout(
			() => void api.listCanvases({ words, limit: shown }).then((next) => current && setList(next)),
			words ? 200 : 0,
		);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [words, world, refresh, shown]);
	const changed = useCallback(() => setRefresh((count) => count + 1), []);
	const create = async () => {
		const made = await api.writeCanvas({ create: { title: "Untitled" } });
		if (made.ok) {
			setOpen(made.id);
			changed();
		}
	};
	const canvases = list?.ok ? list.canvases : [];
	return (
		<div className="wp-canvases" data-open={Boolean(open)}>
			<section className="wp-canvas-list" aria-label="Canvases">
				<header className="wp-conversation-header">
					<div>
						<h1>Canvases</h1>
					</div>
					<button type="button" className="wp-canvas-new" title="New canvas" onClick={() => void create()}>
						<Icon name="plus" /> New
					</button>
				</header>
				<div className="wp-threads-tools">
					<label className="wp-find wp-threads-find">
						<Icon name="search" />
						<input
							aria-label="Search canvases"
							placeholder="Search titles and text"
							value={words}
							onChange={(event) => setWords(event.target.value)}
						/>
					</label>
				</div>
				{list && !list.ok && <p className="wp-activity-calm">{list.reason}</p>}
				{list?.ok && !canvases.length && (
					<p className="wp-activity-calm">{words ? "No canvas mentions that." : "No canvases yet."}</p>
				)}
				<ul className="wp-canvas-rows">
					{canvases.map((canvas) => (
						<CanvasRow key={canvas.id} canvas={canvas} open={open === canvas.id} choose={() => setOpen(canvas.id)} />
					))}
					{canvases.length === shown && (
						<li>
							<button type="button" className="wp-canvas-more" onClick={() => setShown(shown + PAGE)}>
								Show older canvases
							</button>
						</li>
					)}
				</ul>
			</section>
			{open ? (
				<CanvasEditor key={open} id={open} world={world} close={() => setOpen(undefined)} changed={changed} />
			) : (
				<div className="wp-canvas-empty">
					<Icon name="file" />
					<p>Choose a canvas, or make a new one.</p>
				</div>
			)}
		</div>
	);
}

function CanvasRow({ canvas, open, choose }: { canvas: CanvasSummary; open: boolean; choose: () => void }) {
	return (
		<li>
			<button type="button" aria-pressed={open} onClick={choose}>
				<strong>
					{canvas.pinned && <Icon name="bookmark" />}
					{canvas.title}
				</strong>
				<span>{canvas.preview || "Empty"}</span>
				<time>{ago(canvas.updatedAt)}</time>
			</button>
		</li>
	);
}

type Save = { state: "saved" | "saving" | "unsaved"; at?: number } | { state: "conflict" | "failed"; reason: string };

function CanvasEditor({
	id,
	world,
	close,
	changed,
}: {
	id: string;
	world: WorldSnapshot;
	close: () => void;
	changed: () => void;
}) {
	const [title, setTitle] = useState("");
	const [pinned, setPinned] = useState(false);
	const [save, setSave] = useState<Save>({ state: "saved" });
	const [missing, setMissing] = useState<string>();
	const [slash, setSlash] = useState<{ query: string; from: number; x: number; y: number; index: number }>();

	const version = useRef(0);
	const dirty = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const editorRef = useRef<Editor | null>(null);
	const titleRef = useRef("");

	const flush = useCallback(async () => {
		clearTimeout(timer.current);
		const editor = editorRef.current;
		if (!dirty.current || !editor) return;
		dirty.current = false;
		setSave({ state: "saving" });
		const result = await api.writeCanvas({
			update: id,
			base: version.current,
			title: titleRef.current,
			body: editor.getMarkdown(),
		});
		if (result.ok) {
			version.current = result.version;
			setSave({ state: "saved", at: Date.now() });
			changed();
		} else {
			dirty.current = true;
			setSave({ state: result.changed ? "conflict" : "failed", reason: result.reason });
		}
	}, [id, changed]);
	const later = useCallback(() => {
		dirty.current = true;
		setSave({ state: "unsaved" });
		clearTimeout(timer.current);
		timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
	}, [flush]);

	const editor = useEditor({
		extensions: [
			StarterKit,
			TaskList,
			TaskItem.configure({ nested: true }),
			Placeholder.configure({ placeholder: "Write, or type / for headings, to-dos, lists and more" }),
			Markdown,
		],
		editorProps: { attributes: { class: "wp-canvas-doc", "aria-label": "Canvas text" } },
		onUpdate: ({ editor: current }) => {
			later();
			const { $from } = current.state.selection;
			const line = $from.parent.textContent;
			const match = /^\/(\w*)$/.exec(line.slice(0, $from.parentOffset));
			if (match && $from.parent.type.name === "paragraph") {
				const box = current.view.coordsAtPos($from.pos);
				setSlash({ query: match[1]!, from: $from.start(), x: box.left, y: box.bottom, index: 0 });
			} else setSlash(undefined);
		},
	});
	editorRef.current = editor;

	const load = useCallback(async () => {
		const read = await api.readCanvas(id);
		if (!read.ok) return setMissing(read.reason);
		version.current = read.canvas.version;
		titleRef.current = read.canvas.title;
		setTitle(read.canvas.title);
		setPinned(read.canvas.pinned);
		editorRef.current?.commands.setContent(read.canvas.body, { contentType: "markdown", emitUpdate: false });
		dirty.current = false;
		setSave({ state: "saved", at: read.canvas.updatedAt });
	}, [id]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: load once the editor exists, for this canvas.
	useEffect(() => {
		if (editor) void load();
	}, [editor, id]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: every snapshot can carry another writer's change.
	useEffect(() => {
		if (dirty.current || !editor) return;
		void api.readCanvas(id).then((read) => {
			if (!read.ok || dirty.current || read.canvas.version === version.current) return;
			void load();
		});
	}, [world]);

	useEffect(() => () => void flush(), [flush]);

	const blocks = slash
		? BLOCKS.filter((block) =>
				block.label
					.toLowerCase()
					.replace(/[^a-z0-9]/g, "")
					.includes(slash.query.toLowerCase()),
			)
		: [];
	const pick = (block: (typeof BLOCKS)[number]) => {
		if (!editor || !slash) return;
		editor.chain().focus().deleteRange({ from: slash.from, to: editor.state.selection.from }).run();
		block.run(editor);
		setSlash(undefined);
	};
	const slashKeys = (event: React.KeyboardEvent) => {
		if (!slash || !blocks.length) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			setSlash({ ...slash, index: (slash.index + step + blocks.length) % blocks.length });
		} else if (event.key === "Enter") {
			event.preventDefault();
			pick(blocks[slash.index % blocks.length]!);
		} else if (event.key === "Escape") {
			event.preventDefault();
			setSlash(undefined);
		}
	};
	const togglePin = async () => {
		await flush();
		const result = await api.writeCanvas({ update: id, base: version.current, pinned: !pinned });
		if (result.ok) {
			version.current = result.version;
			setPinned(!pinned);
			changed();
		}
	};
	const remove = async () => {
		clearTimeout(timer.current);
		dirty.current = false;
		const result = await api.writeCanvas({ remove: id });
		if (result.ok) {
			changed();
			close();
		}
	};
	const keepMine = async () => {
		const read = await api.readCanvas(id);
		if (!read.ok) return;
		version.current = read.canvas.version;
		dirty.current = true;
		await flush();
	};
	if (missing)
		return (
			<div className="wp-canvas-empty">
				<p>{missing}</p>
			</div>
		);
	return (
		<section className="wp-canvas" aria-label={`Canvas: ${title || "Untitled"}`}>
			<header className="wp-canvas-head">
				<button type="button" className="wp-thread-back" aria-label="Back to all canvases" onClick={close}>
					<Icon name="chevron-right" />
				</button>
				<span className="wp-canvas-status" data-state={save.state} role="status">
					{save.state === "saving"
						? "Saving\u2026"
						: save.state === "unsaved"
							? "Edited"
							: save.state === "saved"
								? save.at
									? `Saved ${ago(save.at)}`
									: "Saved"
								: save.state === "conflict"
									? "Changed elsewhere"
									: `Not saved: ${"reason" in save ? save.reason : ""}`}
				</span>
				<button type="button" aria-pressed={pinned} onClick={() => void togglePin()}>
					{pinned ? "Pinned" : "Pin"}
				</button>
				<button type="button" onClick={() => void remove()}>
					Delete
				</button>
			</header>
			{save.state === "conflict" && (
				<div className="wp-canvas-conflict" role="alert">
					<span>Someone wrote in this canvas since you opened it.</span>
					<button type="button" onClick={() => void load()}>
						Load theirs
					</button>
					<button type="button" onClick={() => void keepMine()}>
						Keep mine
					</button>
				</div>
			)}
			<div className="wp-canvas-page">
				<input
					className="wp-canvas-title"
					aria-label="Canvas title"
					placeholder="Untitled"
					value={title}
					onChange={(event) => {
						titleRef.current = event.target.value;
						setTitle(event.target.value);
						later();
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();

							editor?.chain().setTextSelection(1).run();
							editor?.view.focus();
						}
					}}
				/>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: keys reach the "/" menu before the editor. */}
				<div onKeyDownCapture={slashKeys}>
					<EditorContent editor={editor} />
				</div>
			</div>
			{slash && blocks.length > 0 && (
				<ul className="wp-canvas-slash" aria-label="Blocks" style={{ left: slash.x, top: slash.y + 6 }}>
					{blocks.map((block, index) => (
						<li key={block.label}>
							<button
								type="button"
								tabIndex={-1}
								aria-current={index === slash.index % blocks.length}
								onMouseDown={(event) => {
									event.preventDefault();
									pick(block);
								}}
							>
								{block.label}
								<kbd>{block.hint}</kbd>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

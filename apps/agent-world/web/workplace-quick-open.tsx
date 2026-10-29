import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./workplace-icon.js";

export function QuickOpen({ root, onOpen, onClose }: { root: string; onOpen(path: string): void; onClose(): void }) {
	const [paths, setPaths] = useState<string[]>([]);
	const [listedRoot, setListedRoot] = useState(root);
	const [query, setQuery] = useState("");
	const [at, setAt] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const input = useRef<HTMLInputElement>(null);
	const close = useRef<HTMLButtonElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const restoreFocus = useRef(true);
	const matches = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return paths
			.filter((path) => path.toLowerCase().includes(needle))
			.map((path) => {
				const base = path.split("/").at(-1)!.toLowerCase();
				const rank =
					base === needle
						? 0
						: base.startsWith(needle)
							? 1
							: base.includes(needle)
								? 2
								: path.toLowerCase().startsWith(needle)
									? 3
									: 4;
				return { path, rank };
			})
			.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
	}, [paths, query]);
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		input.current?.focus();
		return () => {
			if (restoreFocus.current && previous?.isConnected && previous.getClientRects().length) previous.focus();
		};
	}, []);
	useEffect(() => {
		let live = true;
		setLoading(true);
		setError(undefined);
		void (async () => {
			try {
				const result = await window.agentWorld.workspace.files({ root });
				if (!live) return;
				if (!result.ok) {
					setError(result.reason);
					return;
				}
				setListedRoot(result.root);
				setPaths(result.paths);
			} catch (reason) {
				if (live) setError(String(reason));
			} finally {
				if (live) setLoading(false);
			}
		})();
		return () => {
			live = false;
		};
	}, [root]);
	useEffect(() => {
		if (matches[at]) list.current?.querySelector(`#wp-code-quick-file-${at}`)?.scrollIntoView({ block: "nearest" });
	}, [at, matches]);
	const choose = (path: string) => {
		restoreFocus.current = false;
		onOpen(path);
	};
	return (
		<div
			className="wp-code-quick-backdrop"
			role="presentation"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) {
					restoreFocus.current = false;
					onClose();
				}
			}}
		>
			<section
				className="wp-code-quick"
				role="dialog"
				aria-modal="true"
				aria-label="Quick open file"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						onClose();
					}
					if (event.key === "Tab") {
						event.preventDefault();
						(document.activeElement === input.current ? close.current : input.current)?.focus();
					}
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						if (matches.length)
							setAt((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
						input.current?.focus();
					}
					if (event.key === "Enter" && document.activeElement === input.current) {
						event.preventDefault();
						if (matches[at]) choose(matches[at].path);
					}
				}}
			>
				<header>
					<Icon name="search" />
					<input
						ref={input}
						role="combobox"
						aria-label="Find file by name or path"
						aria-expanded="true"
						aria-controls="wp-code-quick-files"
						aria-activedescendant={matches[at] ? `wp-code-quick-file-${at}` : undefined}
						aria-autocomplete="list"
						placeholder="Find file by name or path"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setAt(0);
						}}
					/>
					<button
						ref={close}
						type="button"
						className="wp-icon-button"
						aria-label="Close quick open"
						title="Close quick open"
						onClick={onClose}
					>
						<Icon name="close" />
					</button>
				</header>
				{error ? (
					<p role="alert" className="wp-code-quick-message">
						{error}
					</p>
				) : loading ? (
					<p role="status" className="wp-code-quick-message">
						Finding files...
					</p>
				) : !matches.length ? (
					<p role="status" className="wp-code-quick-message">
						No matching files.
					</p>
				) : null}
				<div ref={list} className="wp-code-quick-list" id="wp-code-quick-files" role="listbox" aria-label="Files">
					{matches.map(({ path }, index) => (
						<button
							key={path}
							type="button"
							role="option"
							tabIndex={-1}
							id={`wp-code-quick-file-${index}`}
							aria-selected={at === index}
							title={`${listedRoot}/${path}`}
							onClick={() => choose(path)}
						>
							<Icon name="file" />
							<span>
								<strong>{path.split("/").at(-1)}</strong>
								<small>{path}</small>
							</span>
						</button>
					))}
				</div>
			</section>
		</div>
	);
}

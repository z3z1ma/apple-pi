import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Action } from "../../game/actions.js";
import "./pointer.css";
import { pointer } from "./pointer-state.js";

/** RuneScape's pointer chrome as crisp HTML: hover text at the top left and the right-click menu. */
export function PointerLayer() {
	const state = useSyncExternalStore(pointer.subscribe, pointer.get);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") pointer.closeMenu();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	return (
		<>
			{state.hover && state.hover.length > 0 && <HoverText actions={state.hover} />}
			{state.menu && <Menu key={`${state.menu.x},${state.menu.y}`} {...state.menu} />}
		</>
	);
}

function Line({ action }: { action: Action }) {
	return (
		<>
			{action.verb}
			{action.target && (
				<>
					{" "}
					<span className={`pointer-${action.tone ?? "object"}`}>{action.target}</span>
				</>
			)}
		</>
	);
}

function HoverText({ actions }: { actions: Action[] }) {
	const more = actions.length - 1;
	return (
		<div className="pointer-hover" aria-live="off">
			<Line action={actions[0]} />
			{more > 0 && (
				<span className="pointer-more">
					{" "}
					/ {more} more {more === 1 ? "option" : "options"}
				</span>
			)}
		</div>
	);
}

const MARGIN = 6;

/** The menu opens under the pointer, as RuneScape's does, and closes when the pointer leaves it. */
function Menu({ x, y, actions }: { x: number; y: number; actions: Action[] }) {
	const ref = useRef<HTMLDivElement>(null);
	const [at, setAt] = useState<{ left: number; top: number }>({ left: x, top: y });
	useLayoutEffect(() => {
		const box = ref.current?.getBoundingClientRect();
		if (!box) return;
		const left = Math.max(MARGIN, Math.min(x - box.width / 2, window.innerWidth - box.width - MARGIN));
		const top = Math.max(MARGIN, Math.min(y - 12, window.innerHeight - box.height - MARGIN));
		setAt({ left, top });
	}, [x, y]);
	const choose = (action?: Action) => {
		pointer.closeMenu();
		action?.run();
	};
	return (
		<div
			ref={ref}
			className="pointer-menu"
			role="menu"
			aria-label="Choose option"
			style={{ left: at.left, top: at.top }}
			onMouseLeave={() => pointer.closeMenu()}
		>
			<div className="pointer-menu-title">Choose Option</div>
			{actions.map((action, i) => (
				<button
					// biome-ignore lint/suspicious/noArrayIndexKey: two targets can offer the same line.
					key={`${i}:${action.label}`}
					type="button"
					role="menuitem"
					onClick={() => choose(action)}
					onContextMenu={() => choose(action)}
				>
					<Line action={action} />
				</button>
			))}
			<button type="button" role="menuitem" onClick={() => choose()} onContextMenu={() => choose()}>
				Cancel
			</button>
		</div>
	);
}

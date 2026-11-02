import { type CSSProperties, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./workplace-resize.css";

type Options = {
	label: string;
	variable: string;
	axis: "x" | "y";
	direction: 1 | -1;
	min: number;
	max: () => number;
	enabled?: boolean;
};

export function usePaneResize(options: Options) {
	const pane = useRef<HTMLElement>(null);
	const ref = useCallback((element: HTMLElement | null) => {
		pane.current = element;
	}, []);
	const handle = useRef<HTMLHRElement>(null);
	const latest = useRef(options);
	latest.current = options;
	const [size, setSize] = useState<number>();
	const [metrics, setMetrics] = useState({ min: 0, max: 0, now: 0 });
	const [dragging, setDragging] = useState(false);
	const drag = useRef<{ pointer: number; start: number; size: number; value: number | undefined } | undefined>(
		undefined,
	);
	const enabled = options.enabled !== false;
	const bounds = () => {
		const max = Math.max(0, latest.current.max());
		return { min: Math.min(latest.current.min, max), max };
	};
	const apply = (value: number) => {
		const range = bounds();
		setSize(Math.max(range.min, Math.min(range.max, value)));
	};
	const finish = useCallback((restore = false) => {
		const active = drag.current;
		if (!active) return;
		drag.current = undefined;
		if (restore) setSize(active.value);
		if (handle.current?.hasPointerCapture(active.pointer)) handle.current.releasePointerCapture(active.pointer);
		setDragging(false);
	}, []);
	const update = useRef(() => {});
	update.current = () => {
		if (!enabled || !pane.current || !handle.current?.getClientRects().length) return;
		const rect = pane.current.getBoundingClientRect();
		const now = latest.current.axis === "x" ? rect.width : rect.height;
		if (!now) return;
		const range = bounds();
		setMetrics((previous) =>
			previous.min === range.min && previous.max === range.max && previous.now === Math.round(now)
				? previous
				: { ...range, now: Math.round(now) },
		);
		setSize((value) => (value === undefined ? value : Math.max(range.min, Math.min(range.max, value))));
	};
	useLayoutEffect(() => {
		update.current();
	});
	useLayoutEffect(() => {
		if (!enabled || !pane.current) return;
		const observer = new ResizeObserver(() => update.current());
		for (let node: HTMLElement | null = pane.current; node; node = node.parentElement) observer.observe(node);
		return () => observer.disconnect();
	}, [enabled]);
	useLayoutEffect(() => {
		if (!enabled) {
			setDragging(false);
			return;
		}
		if (!dragging) return;
		const onBlur = () => finish();
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			finish(true);
		};
		window.addEventListener("blur", onBlur);
		window.addEventListener("keydown", onEscape, true);
		return () => {
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("keydown", onEscape, true);
			const active = drag.current;
			if (active && handle.current?.hasPointerCapture(active.pointer))
				handle.current.releasePointerCapture(active.pointer);
			drag.current = undefined;
		};
	}, [dragging, enabled, finish]);
	const style = { [options.variable]: size === undefined ? undefined : `${size}px` } as CSSProperties;
	const separator = enabled ? (
		<>
			<hr
				ref={handle}
				tabIndex={0}
				className={`wp-pane-resize wp-pane-resize-${options.axis}`}
				aria-label={options.label}
				aria-orientation={options.axis === "x" ? "vertical" : "horizontal"}
				aria-valuemin={Math.round(metrics.min)}
				aria-valuemax={Math.round(metrics.max)}
				aria-valuenow={metrics.now}
				onPointerDown={(event) => {
					if (event.button !== 0 || !event.isPrimary || !pane.current) return;
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.focus({ preventScroll: true });
					const rect = pane.current.getBoundingClientRect();
					drag.current = {
						pointer: event.pointerId,
						start: options.axis === "x" ? event.clientX : event.clientY,
						size: options.axis === "x" ? rect.width : rect.height,
						value: size,
					};
					event.currentTarget.setPointerCapture(event.pointerId);
					setDragging(true);
				}}
				onPointerMove={(event) => {
					const active = drag.current;
					if (!active || active.pointer !== event.pointerId) return;
					const position = options.axis === "x" ? event.clientX : event.clientY;
					apply(active.size + (position - active.start) * options.direction);
				}}
				onPointerUp={() => finish()}
				onPointerCancel={() => finish()}
				onLostPointerCapture={() => finish()}
				onKeyDown={(event) => {
					const range = bounds();
					const keys = options.axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
					if (![...keys, "Home", "End"].includes(event.key)) return;
					event.preventDefault();
					event.stopPropagation();
					if (event.key === "Home") apply(range.min);
					else if (event.key === "End") apply(range.max);
					else apply(metrics.now + (event.key === keys[0] ? -8 : 8) * options.direction);
				}}
			/>
			{dragging &&
				createPortal(
					<div className={`wp-pane-resize-shield wp-pane-resize-${options.axis}`} aria-hidden="true" />,
					document.body,
				)}
		</>
	) : null;
	return { pane, ref, style, separator };
}

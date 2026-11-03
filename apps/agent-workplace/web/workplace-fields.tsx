import { type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./workplace-icon.js";
import { PersonAvatar } from "./workplace-people.js";
import "./workplace-fields.css";

export type Choice<T extends string> = { value: T; label: string; detail?: string; disabled?: boolean };

const FILTER_FROM = 8;

function usePlacement(anchor: React.RefObject<HTMLElement | null>, open: boolean) {
	const [place, setPlace] = useState<React.CSSProperties>({});
	useLayoutEffect(() => {
		if (!open || !anchor.current) return;
		const place = () => {
			const box = anchor.current!.getBoundingClientRect();
			const below = window.innerHeight - box.bottom;
			const height = Math.min(320, Math.max(below, box.top) - 12);
			setPlace(
				below >= Math.min(220, box.top)
					? { top: box.bottom + 4, left: box.left, minWidth: box.width, maxHeight: height }
					: { bottom: window.innerHeight - box.top + 4, left: box.left, minWidth: box.width, maxHeight: height },
			);
		};
		place();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [anchor, open]);
	return place;
}

function useOutside(open: boolean, close: () => void, ...inside: React.RefObject<HTMLElement | null>[]) {
	useEffect(() => {
		if (!open) return;
		const press = (event: MouseEvent) => {
			if (inside.some((ref) => ref.current?.contains(event.target as Node))) return;
			close();
		};
		document.addEventListener("mousedown", press, true);
		return () => document.removeEventListener("mousedown", press, true);
	});
}

export function Select<T extends string>({
	value,
	options,
	onChange,
	label,
	disabled,
	placeholder = "Choose\u2026",
	id,
	className,
}: {
	value: T;
	options: Choice<T>[];
	onChange: (value: T) => void;

	label: string;
	disabled?: boolean;
	placeholder?: string;
	id?: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState("");
	const [active, setActive] = useState(0);
	const button = useRef<HTMLButtonElement>(null);
	const popup = useRef<HTMLDivElement>(null);
	const list = useId();
	const place = usePlacement(button, open);
	const typed = useRef({ text: "", at: 0 });
	const needle = filter.trim().toLowerCase();
	const shown = needle
		? options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(needle))
		: options;
	const chosen = options.find((option) => option.value === value);
	const close = (focus = true) => {
		setOpen(false);
		setFilter("");
		if (focus) button.current?.focus();
	};
	useOutside(open, () => close(false), button, popup);
	const show = () => {
		if (disabled) return;
		setActive(Math.max(0, options.indexOf(chosen!)));
		setOpen(true);
	};
	const pick = (option: Choice<T> | undefined) => {
		if (!option || option.disabled) return;
		if (option.value !== value) onChange(option.value);
		close();
	};
	const keys = (event: KeyboardEvent) => {
		if (!open) {
			if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
				event.preventDefault();
				show();
			}
			return;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			setActive((current) => Math.min(shown.length - 1, Math.max(0, current + step)));
		} else if (event.key === "Home" || event.key === "End") {
			event.preventDefault();
			setActive(event.key === "Home" ? 0 : shown.length - 1);
		} else if (event.key === "Enter") {
			event.preventDefault();
			pick(shown[active]);
		} else if (event.key === "Escape" || event.key === "Tab") {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
			}
			close(event.key === "Escape");
		} else if (event.key.length === 1 && options.length <= FILTER_FROM && !event.metaKey && !event.ctrlKey) {
			const now = Date.now();
			typed.current = { text: now - typed.current.at < 700 ? typed.current.text + event.key : event.key, at: now };
			const found = shown.findIndex((option) =>
				option.label.toLowerCase().startsWith(typed.current.text.toLowerCase()),
			);
			if (found >= 0) setActive(found);
		}
	};
	return (
		<>
			<button
				ref={button}
				id={id}
				type="button"
				role="combobox"
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? list : undefined}
				data-value={value}
				disabled={disabled}
				className={`wp-select${className ? ` ${className}` : ""}`}
				onClick={() => (open ? close() : show())}
				onKeyDown={keys}
			>
				<span data-placeholder={!chosen}>{chosen?.label ?? placeholder}</span>
				<Icon name="chevron-down" />
			</button>
			{open && (
				<div ref={popup} className="wp-select-popup" style={place}>
					{options.length > FILTER_FROM && (
						<input
							// biome-ignore lint/a11y/noAutofocus: the filter is where typing goes once the list is open.
							autoFocus
							className="wp-select-filter"
							aria-label={`Filter ${label}`}
							placeholder="Type to filter"
							value={filter}
							onChange={(event) => {
								setFilter(event.target.value);
								setActive(0);
							}}
							onKeyDown={keys}
						/>
					)}
					<div id={list} role="listbox" aria-label={label}>
						{shown.map((option, index) => (
							<div
								key={option.value}
								role="option"
								tabIndex={-1}
								data-value={option.value}
								aria-selected={option.value === value}
								aria-disabled={option.disabled || undefined}
								data-active={index === active}
								ref={(node) => {
									if (index === active) node?.scrollIntoView({ block: "nearest" });
								}}
								onMouseEnter={() => setActive(index)}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => pick(option)}
								onKeyDown={keys}
							>
								<span className="wp-option-text">
									{option.label}
									{option.detail && <small>{option.detail}</small>}
								</span>
								{option.value === value && <Icon name="check" />}
							</div>
						))}
						{!shown.length && <p className="wp-select-none">Nothing matches.</p>}
					</div>
				</div>
			)}
		</>
	);
}

export type Recipient = { id: string; name: string; detail?: string };

export function Recipients({
	label,
	people,
	chosen,
	onChange,
	disabled,
	placeholder,
	trailing,
	free = false,
}: {
	label: string;
	people: Recipient[];
	chosen: string[];
	onChange: (ids: string[]) => void;
	disabled?: boolean;
	placeholder?: string;

	trailing?: ReactNode;

	free?: boolean;
}) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const field = useRef<HTMLDivElement>(null);
	const popup = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const list = useId();
	const place = usePlacement(field, open);
	useOutside(open, () => setOpen(false), field, popup);
	const needle = query.trim().toLowerCase();
	const shown = people
		.filter(
			(person) =>
				!chosen.includes(person.id) &&
				(!needle ||
					person.id.toLowerCase() === needle ||
					person.name
						.toLowerCase()
						.split(/\s+/)
						.some((part) => part.startsWith(needle)) ||
					(person.detail ?? "").toLowerCase().includes(needle)),
		)
		.sort((a, b) => Number(b.id.toLowerCase() === needle) - Number(a.id.toLowerCase() === needle));
	const add = (person: Recipient | undefined) => {
		if (!person) return;
		onChange([...chosen, person.id]);
		setQuery("");
		setActive(0);
		setOpen(false);
		input.current?.focus();
	};
	const keys = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setOpen(true);
			const step = event.key === "ArrowDown" ? 1 : -1;
			setActive((current) => Math.min(shown.length - 1, Math.max(0, current + step)));
		} else if ((event.key === "Enter" || event.key === "Tab" || event.key === ",") && open && query.trim()) {
			const typed = query.trim();
			if (!shown.length && !(free && event.key === "Enter")) return;
			event.preventDefault();
			event.stopPropagation();
			if (shown.length) add(shown[Math.min(active, shown.length - 1)]);
			else if (!chosen.includes(typed)) add({ id: typed, name: typed });
			else setQuery("");
		} else if (event.key === "Backspace" && !query && chosen.length) {
			onChange(chosen.slice(0, -1));
		} else if (event.key === "Escape" && open) {
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
		}
	};
	const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? id;
	return (
		<div ref={field} className="wp-recipients" data-disabled={disabled || undefined}>
			<label className="wp-recipients-label" htmlFor={`${list}-input`}>
				{label}
			</label>
			{chosen.map((id) => (
				<span key={id} className="wp-recipient-chip" data-value={id}>
					<PersonAvatar id={id} name={nameOf(id)} interactive={false} />
					{nameOf(id)}
					{!disabled && (
						<button
							type="button"
							aria-label={`Remove ${nameOf(id)}`}
							onClick={() => onChange(chosen.filter((other) => other !== id))}
						>
							<Icon name="close" />
						</button>
					)}
				</span>
			))}
			<input
				ref={input}
				id={`${list}-input`}
				role="combobox"
				aria-label={`${label} recipients`}
				aria-expanded={open && shown.length > 0}
				aria-controls={open ? list : undefined}
				aria-autocomplete="list"
				placeholder={chosen.length ? "" : (placeholder ?? "Name or role")}
				value={query}
				disabled={disabled}
				onFocus={() => setOpen(true)}
				onClick={() => setOpen(true)}
				onChange={(event) => {
					setQuery(event.target.value);
					setOpen(true);
					setActive(0);
				}}
				onKeyDown={keys}
			/>
			{trailing}
			{open && !disabled && shown.length > 0 && (
				<div
					ref={popup}
					id={list}
					role="listbox"
					aria-label={`${label} suggestions`}
					className="wp-select-popup wp-recipients-popup"
					style={place}
				>
					{shown.map((person, index) => (
						<div
							key={person.id}
							role="option"
							data-value={person.id}
							tabIndex={-1}
							aria-selected={index === active}
							data-active={index === active}
							ref={(node) => {
								if (index === active) node?.scrollIntoView({ block: "nearest" });
							}}
							onMouseEnter={() => setActive(index)}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => add(person)}
							onKeyDown={() => {}}
						>
							<PersonAvatar id={person.id} name={person.name} interactive={false} />
							<span className="wp-option-text">
								{person.name}
								{person.detail && <small>{person.detail}</small>}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

import {
	createContext,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import "./workplace-context-menu.css";

type MenuItem = { label: string; onSelect: () => void; disabled?: boolean };
type Menu = { x: number; y: number; trigger: HTMLElement; items: MenuItem[] };
type OpenMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, items: MenuItem[]) => void;
const MenuContext = createContext<OpenMenu | null>(null);

export function useWorkplaceMenu(): OpenMenu {
	const open = useContext(MenuContext);
	if (!open) throw new Error("Workplace menus require WorkplaceMenuProvider.");
	return open;
}

export function WorkplaceMenuProvider({ children }: { children: ReactNode }) {
	const [menu, setMenu] = useState<Menu>();
	const open: OpenMenu = useCallback((event, items) => {
		if ("key" in event && event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
		event.preventDefault();
		event.stopPropagation();
		const trigger = event.currentTarget;
		const box = trigger.getBoundingClientRect();
		setMenu({
			x: "clientX" in event ? event.clientX : box.left,
			y: "clientY" in event ? event.clientY : box.bottom,
			trigger,
			items,
		});
	}, []);
	const close = useCallback(
		(restore = true) => {
			setMenu(undefined);
			if (restore && menu?.trigger.isConnected) menu.trigger.focus();
		},
		[menu],
	);
	return (
		<MenuContext.Provider value={open}>
			{children}
			{menu &&
				createPortal(
					<MenuPopup key={`${menu.x}:${menu.y}`} menu={menu} close={close} />,
					menu.trigger.closest(".wp-app") ?? document.body,
				)}
		</MenuContext.Provider>
	);
}

function MenuPopup({ menu, close }: { menu: Menu; close: (restore?: boolean) => void }) {
	const element = useRef<HTMLDivElement>(null);
	const [at, setAt] = useState({ left: menu.x, top: menu.y });
	useLayoutEffect(() => {
		const box = element.current!.getBoundingClientRect();
		setAt({
			left: Math.max(8, Math.min(menu.x, innerWidth - box.width - 8)),
			top: Math.max(8, Math.min(menu.y, innerHeight - box.height - 8)),
		});
		(element.current!.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? element.current!).focus();
		const outside = (event: Event) => {
			if (!element.current?.contains(event.target as Node)) close(false);
		};
		const dismiss = () => close();
		window.addEventListener("pointerdown", outside, true);
		window.addEventListener("focusin", outside, true);
		window.addEventListener("resize", dismiss);
		return () => {
			window.removeEventListener("pointerdown", outside, true);
			window.removeEventListener("focusin", outside, true);
			window.removeEventListener("resize", dismiss);
		};
	}, [menu, close]);
	return (
		<div
			ref={element}
			role="menu"
			tabIndex={-1}
			aria-label="Actions"
			className="wp-context-menu"
			style={at}
			onContextMenu={(event) => event.preventDefault()}
			onKeyDown={(event) => {
				const buttons = [...element.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
				const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
				let next: number | undefined;
				if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
				if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
				if (event.key === "Home") next = 0;
				if (event.key === "End") next = buttons.length - 1;
				if (next !== undefined) {
					event.preventDefault();
					event.stopPropagation();
					buttons[next]?.focus();
				}
				if (event.key === "Escape" || event.key === "Tab") {
					event.preventDefault();
					event.stopPropagation();
					close();
				}
			}}
		>
			{menu.items.map((item) => (
				<button
					key={item.label}
					type="button"
					role="menuitem"
					tabIndex={-1}
					disabled={item.disabled}
					onClick={() => {
						close();
						item.onSelect();
					}}
				>
					{item.label}
				</button>
			))}
		</div>
	);
}

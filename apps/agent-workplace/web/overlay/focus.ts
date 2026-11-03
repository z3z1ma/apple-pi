const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabStops(container: HTMLElement): HTMLElement[] {
	return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(element) => element.getClientRects().length > 0 && !element.closest("[inert]"),
	);
}

export function trapTab(event: KeyboardEvent, container: HTMLElement | null | undefined): boolean {
	if (event.key !== "Tab" || !container) return false;
	const stops = tabStops(container);
	const active = document.activeElement;
	const inside = active instanceof Node && container.contains(active);
	const first = stops[0];
	const last = stops.at(-1);
	let next: HTMLElement | undefined;
	if (!first || !last) next = undefined;
	else if (!inside) next = event.shiftKey ? last : first;
	else if (event.shiftKey && (active === first || !stops.includes(active as HTMLElement))) next = last;
	else if (!event.shiftKey && active === last) next = first;
	else return false;
	event.preventDefault();
	next?.focus({ preventScroll: true });
	return true;
}

export function focusWorld() {
	const game = document.getElementById("game");
	if (!game) return;
	if (!game.hasAttribute("tabindex")) game.tabIndex = -1;
	game.focus({ preventScroll: true });
}

// Keyboard focus around the panels that open over the world (the conversation panel, the function places' panels, and
// their confirmations): while one is open, Tab and Shift+Tab cycle through its own controls and never wander into the
// interface or the world behind it; once it closes, the focus goes back to the world, so its keys work again at once.

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The controls Tab reaches in `container`, in order: enabled, focusable, and drawn. */
function tabStops(container: HTMLElement): HTMLElement[] {
	return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(element) => element.getClientRects().length > 0 && !element.closest("[inert]"),
	);
}

/**
 * Keep Tab inside `container`: from its last control on to its first (and back with Shift), and from anywhere outside
 * it to its first control. Returns whether it moved the focus itself (the event is then spent).
 */
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

/** Give the focus back to the world (its canvas), so its keys (walking the view, the walk grid) work again. */
export function focusWorld() {
	const game = document.getElementById("game");
	if (!game) return;
	if (!game.hasAttribute("tabindex")) game.tabIndex = -1;
	game.focus({ preventScroll: true });
}

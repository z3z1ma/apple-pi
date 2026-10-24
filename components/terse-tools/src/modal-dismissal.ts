import { type Component, type OverlayHandle, TuiAltScreen, type TuiMouseEvent } from "@earendil-works/pi-tui";

const PATCHED = Symbol.for("apple_pi.modal_outside_click");

// Keep the rest of the gesture away from the transcript, even after Escape removes the modal.
const dismissedGesture: Component = {
	render: () => [],
	invalidate() {},
	handleMouse: () => ({ handled: true }),
};

export function installModalDismissal(): void {
	// Pi exposes overlay bounds but keeps the normalized mouse dispatch hook protected.
	const proto = TuiAltScreen.prototype as unknown as TuiAltScreen & {
		[PATCHED]?: boolean;
		showOverlay: TuiAltScreen["showOverlay"];
		getFocusedComponent: TuiAltScreen["getFocusedComponent"];
		dispatchMouseToOverlay: (event: TuiMouseEvent) => {
			hit: boolean;
			result?: {
				handled: true;
				target: { component: Component; originX: number; originY: number; width: number; height: number };
			};
		};
	};
	if (proto[PATCHED]) return;
	proto[PATCHED] = true;
	const handles = new WeakMap<Component, OverlayHandle>();
	const showOverlay = proto.showOverlay;
	const dispatch = proto.dispatchMouseToOverlay;
	proto.showOverlay = function (component, options) {
		const handle = showOverlay.call(this, component, options);
		if (!options?.nonCapturing) handles.set(component, handle);
		return handle;
	};
	proto.dispatchMouseToOverlay = function (event) {
		const focused = this.getFocusedComponent();
		const handle = focused ? handles.get(focused) : undefined;
		const bounds = handle?.isFocused() ? handle.getBounds() : undefined;
		if (
			focused?.handleInput &&
			bounds &&
			event.type === "press" &&
			event.button === "left" &&
			(event.screenX < bounds.col ||
				event.screenX >= bounds.col + bounds.width ||
				event.screenY < bounds.row ||
				event.screenY >= bounds.row + bounds.height)
		) {
			focused.handleInput("\x1b");
			return {
				hit: true,
				result: {
					handled: true,
					target: { component: dismissedGesture, originX: 0, originY: 0, width: event.width, height: event.height },
				},
			};
		}
		return dispatch.call(this, event);
	};
}

import { InteractiveMode } from "@earendil-works/pi-coding-agent";

import type { InteractiveModeConstructor, StatusFooterFactory, TelemetrySession } from "./types.js";

interface BridgeOptions {
	setFooter: (factory: StatusFooterFactory) => void;
	factory: StatusFooterFactory;
	interactiveMode?: InteractiveModeConstructor;
	onCapture?: (session: TelemetrySession) => void;
}

export interface TelemetryBridgeResult {
	installed: boolean;
	reason?: string;
	error?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Validate and capture only the private runtime shape authorized for Pi 0.84.x. */
export function captureTelemetrySession(instance: unknown): TelemetrySession | undefined {
	if (!isObject(instance)) return undefined;
	let session: unknown;
	try {
		session = instance.session;
	} catch {
		return undefined;
	}
	if (!isObject(session)) return undefined;
	const sessionManager = session.sessionManager;
	const modelRuntime = session.modelRuntime;
	if (!isObject(sessionManager) || typeof sessionManager.getEntries !== "function") return undefined;
	if (!isObject(modelRuntime) || typeof modelRuntime.isUsingSubscription !== "function") return undefined;
	let autoCompactionEnabled: unknown;
	try {
		autoCompactionEnabled = session.autoCompactionEnabled;
	} catch {
		return undefined;
	}
	if (typeof autoCompactionEnabled !== "boolean") return undefined;
	return session as unknown as TelemetrySession;
}

function defaultInteractiveMode(): InteractiveModeConstructor {
	return InteractiveMode as unknown as InteractiveModeConstructor;
}

/**
 * Install one exact footer factory while synchronously borrowing the active
 * InteractiveMode session. Non-target calls pass through untouched, and the
 * prototype is restored in every path before this function returns.
 */
export function installFooterWithTelemetryBridge(options: BridgeOptions): TelemetryBridgeResult {
	const interactiveMode = options.interactiveMode ?? defaultInteractiveMode();
	const prototype = interactiveMode?.prototype;
	if (!prototype || typeof prototype.setExtensionFooter !== "function") {
		return { installed: false, reason: "Pi's private footer installation seam is unavailable" };
	}

	const original = prototype.setExtensionFooter;
	let targetCallSeen = false;
	let captured = false;
	let failure: string | undefined;
	let patched = false;

	const intercepted = function (this: unknown, requestedFactory: unknown): unknown {
		if (requestedFactory !== options.factory) return Reflect.apply(original, this, [requestedFactory]);
		targetCallSeen = true;
		const session = captureTelemetrySession(this);
		if (!session) {
			failure = "Pi's active session does not match the 0.84.x telemetry shape";
			return undefined;
		}
		captured = true;
		options.onCapture?.(session);
		try {
			return Reflect.apply(original, this, [requestedFactory]);
		} catch (error) {
			// The native method clears the footer before invoking a custom factory.
			// Restore it if construction failed so the editor/status surfaces remain usable.
			try {
				Reflect.apply(original, this, [undefined]);
			} catch {
				// Preserve the original factory error; the caller still reports fallback.
			}
			throw error;
		}
	};

	try {
		if (!Reflect.set(prototype, "setExtensionFooter", intercepted, prototype)) {
			return { installed: false, reason: "Pi's private footer seam could not be patched" };
		}
		patched = true;
		options.setFooter(options.factory);
	} catch (error) {
		return {
			installed: false,
			reason: failure ?? "Apple Pi input card footer construction failed",
			error,
		};
	} finally {
		if (patched) Reflect.set(prototype, "setExtensionFooter", original, prototype);
	}

	if (!targetCallSeen) return { installed: false, reason: "Pi did not synchronously install the requested footer" };
	if (!captured) return { installed: false, reason: failure ?? "Apple Pi input card telemetry capture failed" };
	return { installed: true };
}

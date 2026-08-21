// Apple Pi-owned TUI input card. The extension wrapper only installs this
// component and deliberately leaves RPC mode alone.

export { captureTelemetrySession, installFooterWithTelemetryBridge } from "./bridge.js";
export type { InputCardInstallOptions } from "./installer.js";
export { default, EmptyFooter, installForTui } from "./installer.js";
export type {
	FooterSnapshot,
	FooterStatus,
	FooterUsageTotals,
	InteractiveModeConstructor,
	InteractiveModePrototype,
	StatusFooterFactory,
	TelemetrySession,
} from "./types.js";
export type { InputCardEditorFactory } from "./ui/input-card.js";
export {
	collectFooterSnapshot,
	collectInputCardSnapshot,
	createInputCardEditorFactory,
	fitToWidth,
	formatCwdForFooter,
	formatTokens,
	InputCardEditor,
	renderCard,
	renderFooter,
	renderInputCard,
	renderStatusFooter,
	sanitizeStatusText,
} from "./ui/input-card.js";
export { collectUsageTotals } from "./usage.js";

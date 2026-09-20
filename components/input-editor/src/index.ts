// Apple Pi-owned TUI input editor. The extension wrapper only installs this
// component and deliberately leaves RPC mode alone.

export { default, EmptyFooter, installForTui } from "./installer.js";
export type { EmptyFooterFactory, FooterSnapshot, FooterStatus } from "./types.js";
export type { InputCardEditorFactory, InputCardFactory } from "./ui/input-editor.js";
export {
	collectFooterSnapshot,
	collectInputCardSnapshot,
	createInputCardEditorFactory,
	fitToWidth,
	InputCardEditor,
	renderCard,
	renderFooter,
	renderInputCard,
	renderStatusFooter,
	sanitizeStatusText,
} from "./ui/input-editor.js";

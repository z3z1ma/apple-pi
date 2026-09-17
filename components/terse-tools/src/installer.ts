import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatThinkingSpinnerMessage } from "./formatters.js";
import { installTerseToolRenderer } from "./patch.js";

export default function (pi?: ExtensionAPI): void {
	installTerseToolRenderer();

	if (!pi || typeof pi.on !== "function") {
		return;
	}

	const clearThinkingLabel = (ctx: ExtensionContext) => {
		if (typeof ctx?.ui?.setHiddenThinkingLabel === "function") {
			ctx.ui.setHiddenThinkingLabel("");
		}
	};

	const restoreSpinner = (ctx: ExtensionContext) => {
		if (typeof ctx?.ui?.setWorkingMessage === "function") {
			ctx.ui.setWorkingMessage();
		}
	};

	pi.on("session_start", (_event, ctx) => {
		clearThinkingLabel(ctx);
	});

	pi.on("turn_start", (_event, ctx) => {
		clearThinkingLabel(ctx);
	});

	pi.on("message_start", (_event, ctx) => {
		clearThinkingLabel(ctx);
	});

	pi.on("message_update", (event, ctx) => {
		if (event.message?.role !== "assistant") return;
		const msg = event.message;
		if (!Array.isArray(msg.content) || msg.content.length === 0) return;

		let latestThinking: string | undefined;
		let hasNonThinkingAfter = false;
		for (let i = msg.content.length - 1; i >= 0; i--) {
			const block = msg.content[i];
			if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
				latestThinking = block.thinking;
				break;
			}
			if (block.type === "toolCall" || (block.type === "text" && block.text?.trim())) {
				hasNonThinkingAfter = true;
				break;
			}
		}

		if (latestThinking && !hasNonThinkingAfter) {
			const spinnerMsg = formatThinkingSpinnerMessage(latestThinking);
			if (typeof ctx?.ui?.setWorkingMessage === "function") {
				ctx.ui.setWorkingMessage(spinnerMsg);
			}
		} else {
			restoreSpinner(ctx);
		}
	});

	pi.on("tool_execution_start", (_event, ctx) => {
		restoreSpinner(ctx);
	});

	pi.on("message_end", (_event, ctx) => {
		restoreSpinner(ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		restoreSpinner(ctx);
	});

	pi.on("agent_end", (_event, ctx) => {
		restoreSpinner(ctx);
	});
}

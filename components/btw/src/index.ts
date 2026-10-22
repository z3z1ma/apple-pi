import {
	copyToClipboard,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type BtwParentSnapshot,
	buildBtwInjection,
	buildBtwParentSnapshot,
	buildBtwPrompt,
	formatBtwUserMessage,
	getLatestBtwExchange,
} from "./context.js";
import { type BtwConversation, createBtwConversation } from "./session.js";
import { BTW_VIEWPORT_HEIGHT_PCT, BtwViewer } from "./ui/viewer.js";

function report(ctx: ExtensionContext, error: unknown): void {
	ctx.ui.notify(`BTW: ${error instanceof Error ? error.message : String(error)}`, "error");
}

function injectLatestAnswer(pi: ExtensionAPI, ctx: ExtensionContext, conversation: BtwConversation | undefined): void {
	const exchange = conversation && getLatestBtwExchange(conversation.session.messages);
	if (!exchange) {
		ctx.ui.notify("BTW has no completed answer to inject.", "warning");
		return;
	}
	const message = buildBtwInjection(exchange);
	if (ctx.isIdle()) pi.sendUserMessage(message);
	else pi.sendUserMessage(message, { deliverAs: "followUp" });
	ctx.ui.notify("Injected the latest BTW answer.", "info");
}

async function copyLatestAnswer(ctx: ExtensionContext, answer: string): Promise<void> {
	try {
		await copyToClipboard(answer);
		ctx.ui.notify("Copied the latest BTW answer to the clipboard.", "info");
	} catch (error) {
		report(ctx, error);
	}
}

async function openConversation(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	conversation: BtwConversation,
	snapshot: BtwParentSnapshot | undefined,
	current: () => boolean,
	onSnapshotSent: (cursor: string | undefined) => void,
	onClear: () => Promise<void>,
): Promise<void> {
	let pending = snapshot;
	await ctx.ui.custom<undefined>(
		(tui, theme, keybindings, done) =>
			new BtwViewer(tui, conversation.session, conversation, theme, done, keybindings, {
				onSubmitQuestion: (question) => {
					const consumed = pending;
					pending = undefined;
					void (async () => {
						let accepted = false;
						try {
							accepted = current() && (await conversation.submit(buildBtwPrompt(consumed?.context ?? "", question)));
							if (!accepted) throw new Error(conversation.error ?? "The conversation is no longer available.");
							if (current() && consumed) onSnapshotSent(consumed.cursor);
						} catch (error) {
							report(ctx, error);
						}
						if (!accepted && consumed) pending = consumed;
					})();
				},
				onCopyLatestAnswer: (answer) => void copyLatestAnswer(ctx, answer),
				onInjectLatestAnswer: () => injectLatestAnswer(pi, ctx, current() ? conversation : undefined),
				onClearConversation: () => {
					if (current()) void onClear().catch((error) => report(ctx, error));
				},
				onStop: () => {
					void conversation.stop().catch((error) => report(ctx, error));
				},
				formatUserPrompt: formatBtwUserMessage,
			}),
		{
			overlay: true,
			overlayOptions: { anchor: "top-center", width: "90%", maxHeight: `${BTW_VIEWPORT_HEIGHT_PCT}%` },
		},
	);
}

export function install(pi: ExtensionAPI): void {
	let owned: Promise<BtwConversation> | undefined;
	let closing: Promise<void> | undefined;
	let parentCursor: string | undefined;

	const reset = async () => {
		const previous = owned;
		owned = undefined;
		parentCursor = undefined;
		// The command reports creation errors; a failed creation has no session to close.
		const release = previous?.then(
			(conversation) => conversation.close(),
			() => undefined,
		);
		const pending = Promise.all([closing, release]).then(() => undefined);
		closing = pending;
		try {
			await pending;
		} finally {
			if (closing === pending) closing = undefined;
		}
	};
	const clear = async (ctx: ExtensionContext) => {
		const existed = owned !== undefined;
		await reset();
		ctx.ui.notify(existed ? "Cleared the BTW conversation." : "No BTW conversation to clear.", "info");
	};
	pi.on("session_start", reset);
	pi.on("session_tree", reset);
	pi.on("session_shutdown", reset);
	pi.registerShortcut("alt+i", {
		description: "Inject the latest BTW answer into the main conversation",
		handler: async (ctx) => {
			const previous = owned;
			try {
				const conversation = await previous;
				injectLatestAnswer(pi, ctx, previous === owned ? conversation : undefined);
			} catch (error) {
				report(ctx, error);
			}
		},
	});
	pi.registerShortcut("alt+x", {
		description: "Clear the BTW side conversation",
		handler: async (ctx) => {
			try {
				await clear(ctx);
			} catch (error) {
				report(ctx, error);
			}
		},
	});
	pi.registerCommand("btw", {
		description: "Ask or continue a private read-only side conversation",
		handler: async (args, ctx) => {
			if (!ctx.hasUI || ctx.mode !== "tui") return;
			let question = args.trim();
			if (!owned && !question) {
				question = (await ctx.ui.input("Ask BTW", "Question about the current conversation"))?.trim() ?? "";
				if (!question) return;
			}
			const snapshot = buildBtwParentSnapshot(ctx.sessionManager.getBranch(), parentCursor);
			owned ??= createBtwConversation(ctx);
			const previous = owned;
			let conversation: BtwConversation;
			try {
				conversation = await previous;
			} catch (error) {
				if (owned === previous) owned = undefined;
				report(ctx, error);
				return;
			}
			if (previous !== owned) return;
			try {
				if (question) {
					if (!(await conversation.submit(buildBtwPrompt(snapshot.context, question)))) {
						throw new Error(conversation.error ?? "The conversation could not accept the question.");
					}
					if (previous !== owned) return;
					parentCursor = snapshot.cursor;
				}
				await openConversation(
					pi,
					ctx,
					conversation,
					question ? undefined : snapshot,
					() => previous === owned,
					(cursor) => {
						parentCursor = cursor;
					},
					() => clear(ctx),
				);
			} catch (error) {
				report(ctx, error);
			}
		},
	});
}

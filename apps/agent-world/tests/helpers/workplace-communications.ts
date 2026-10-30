import type { CommunicationsApi, ConversationInfo } from "../../src/communications.js";

/** Installed after each browser fixture's legacy World API; retains its observable traces and held operations. */
export function installWorkplaceCommunications() {
	if (window !== window.top) return;
	const w = window as any;
	const api = w.agentWorld;
	const cached = new Map<string, any>();
	const attempts = new Map<string, any>();
	const following = new Map<string, boolean>();
	w.communicationCalls = [];
	const record = (method: string, request: unknown) =>
		w.communicationCalls.push({ method, request: structuredClone(request) });
	const info = async (thread: any): Promise<ConversationInfo> => {
		const snapshot = await api.snapshot();
		const channel = snapshot.workplace?.threads.find((item: any) => item.id === thread.id);
		const joined = following.get(thread.id) ?? thread.participants.some((person: any) => person.id === "operator");
		const archived = !!thread.closed;
		return {
			id: thread.id,
			kind: channel ? "channel" : "mail",
			channel_type: channel ? "topic" : null,
			name: thread.subject,
			purpose: null,
			scope_head: channel?.headquarters ?? null,
			archived,
			pinned: null,
			access: true,
			access_sources: [channel ? "scope" : "member"],
			following: channel ? joined : null,
			read_up_to: thread.readUpTo ?? 0,
			unread: thread.messages.filter(
				(message: any) => message.seq > (thread.readUpTo ?? 0) && message.from !== "operator",
			).length,
			participants: thread.participants.map((person: any) => ({
				...person,
				access_sources: ["member"],
				following: channel ? true : null,
			})),
			invitations: [],
			permissions: {
				post: !archived,
				join: !!channel && !joined,
				invite: false,
				remove: false,
				pin: false,
				archive: false,
				reopen: false,
			},
		};
	};
	const mutate = async (method: "post" | "join" | "leave", request: any) => {
		record(method, request);
		if (attempts.has(request.attempt)) return attempts.get(request.attempt);
		const result =
			method === "post"
				? await api.replyThread(request.thread, request.body)
				: await api.setChannelMembership(request.thread, method === "join");
		if (!result.ok) return { attempt: request.attempt, outcome: "refused" as const, reason: result.reason };
		if (method !== "post") following.set(request.thread, method === "join");
		const thread = cached.get(request.thread);
		const applied = {
			attempt: request.attempt,
			outcome: "applied" as const,
			effect: {
				action: method,
				thread: await info(thread),
				...(method === "post" ? { notify: request.notify ?? [] } : {}),
			},
		};
		attempts.set(request.attempt, applied);
		return applied;
	};
	const communications: CommunicationsApi = {
		readThread: async (request) => {
			record("readThread", request);
			const snapshot = await api.snapshot();
			const isChannel = snapshot.workplace?.threads.some((item: any) => item.id === request.thread);
			const read =
				w.communicationFixture?.read ?? ((id: string) => (isChannel ? api.readWorkplaceThread : api.readThread)(id));
			const result = await read(request.thread);
			if (!result.ok) return result;
			const thread = result.thread;
			cached.set(thread.id, thread);
			const before = thread.readUpTo ?? 0;
			const view = request.view ?? "recent";
			const messages = thread.messages.filter(
				(message: any) => message.seq > (request.after ?? 0) && message.seq <= (request.through ?? Infinity),
			);
			const selected = view === "recent" ? messages.slice(-request.limit) : messages.slice(0, request.limit);
			const through = selected.at(-1)?.seq ?? 0;
			if (view === "catch_up") {
				thread.readUpTo = Math.max(before, through);
				w.communicationFixture?.ack?.(request.thread, thread.readUpTo);
			}
			const page = {
				thread: { ...(await info(thread)), read_up_to: before },
				view,
				messages: selected.map((message: any) => ({
					...message,
					thread: thread.id,
					id: `${thread.id}:${message.seq}`,
					fromName: message.name,
					reference: { thread: thread.id, seq: message.seq, id: `${thread.id}:${message.seq}` },
				})),
				window_through: through,
				acknowledgment: view === "catch_up" ? ("applied" as const) : ("not_requested" as const),
				acknowledged_through: view === "catch_up" ? thread.readUpTo : null,
				last_confirmed_cursor: thread.readUpTo ?? 0,
			};
			return { ok: true, page, ...(request.attempt ? { attempt: request.attempt } : {}) };
		},
		findChannels: async (request) => {
			record("findChannels", request);
			const snapshot = await api.snapshot();
			const threads = await Promise.all(
				(snapshot.workplace?.threads ?? []).map((thread: any) =>
					info(
						cached.get(thread.id) ?? {
							id: thread.id,
							subject: thread.subject,
							closed: thread.closed,
							participants: thread.participants.map((id: string) => ({ id, name: id })),
							messages: [],
						},
					),
				),
			);
			return { ok: true, value: { threads } };
		},
		post: (request) => mutate("post", request),
		join: (request) => mutate("join", request),
		leave: (request) => mutate("leave", request),
		sendMail: async (request) => {
			record("sendMail", request);
			if (attempts.has(request.attempt)) return attempts.get(request.attempt);
			const result = await api.sendMail(request.to[0], request.body);
			const outcome = result.ok ? ("applied" as const) : ("refused" as const);
			const applied = { attempt: request.attempt, outcome, ...(!result.ok ? { reason: result.reason } : {}) };
			attempts.set(request.attempt, applied);
			return applied;
		},
		status: async (request) => {
			record("status", request);
			return attempts.get(request.attempt) ?? { attempt: request.attempt, outcome: "not_recorded" };
		},
		searchMessages: async () => ({ ok: true, value: { messages: [] } }),
		createChannel: async () => {
			throw new Error("Channel creation is outside this retained-reader fixture");
		},
		invite: async () => {
			throw new Error("Invitation is outside this retained-reader fixture");
		},
		removeInvitations: async () => {
			throw new Error("Invitation removal is outside this retained-reader fixture");
		},
		pin: async () => {
			throw new Error("Pinning is outside this retained-reader fixture");
		},
		archive: async () => {
			throw new Error("Archive is outside this retained-reader fixture");
		},
		reopen: async () => {
			throw new Error("Reopen is outside this retained-reader fixture");
		},
	};
	api.communications = communications;
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const VCC_RESUME_CUSTOM_TYPE = "pi-vcc:resume-after-compaction";

export function registerInvisibleContinue(pi: ExtensionAPI): void {
  pi.on("context", (event) => {
    const messages = event.messages.filter((message) => {
      if (message.role !== "custom") return true;
      return message.customType !== VCC_RESUME_CUSTOM_TYPE;
    });
    if (messages.length !== event.messages.length) return { messages };
  });
}

/**
 * Queue a hidden follow-up through AgentSession. This keeps Pi's session-level
 * busy state, retry, compaction, and native steer/follow-up queues coherent.
 */
export function triggerInvisibleContinue(pi: ExtensionAPI): void {
  pi.sendMessage(
    {
      customType: VCC_RESUME_CUSTOM_TYPE,
      content: [],
      display: false,
      details: undefined,
    },
    {
      triggerTurn: true,
      deliverAs: "followUp",
    },
  );
}

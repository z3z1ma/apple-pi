/**
 * Integration tests: proactive threshold + session_before_compact interaction.
 *
 * These tests verify the cross-hook contract:
 * - When proactive trigger calls ctx.compact(), session_before_compact
 *   must NOT cancel the compaction even if tokensBefore differs from
 *   getContextUsage().
 * - The per-model threshold guard was removed from session_before_compact
 *   because the event carries no "reason" field — manual /compact and
 *   auto-compaction are indistinguishable. The proactive trigger handles
 *   the "compact earlier than pi-core" direction.
 */
import { describe, test, expect, afterEach, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, unlinkSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { registerBeforeCompactHook } from "../src/hooks/before-compact";
import { registerProactiveThresholdHook, resetProactiveState } from "../src/hooks/proactive-threshold";
import { isCodexContextOverflowPending } from "../src/core/codex-output-limit";

let tmpDir: string;
let CONFIG_PATH: string;
let AGENT_DIR: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-vcc-test-"));
  CONFIG_PATH = join(tmpDir, "pi-vcc-config.json");
  // Isolate pi-core settings (default compaction enabled) so the agent_end
  // handler's isPiCoreCompactionEnabled() doesn't read the user's real config.
  AGENT_DIR = join(tmpDir, "agent");
  mkdirSync(AGENT_DIR, { recursive: true });
  writeFileSync(join(AGENT_DIR, "settings.json"), JSON.stringify({ compaction: { enabled: true } }));
  process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
  process.env.PI_VCC_CONFIG_PATH = CONFIG_PATH;
});

afterAll(() => {
  delete process.env.PI_VCC_CONFIG_PATH;
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

function setConfig(cfg: Record<string, unknown>) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg));
}

const msg = (id: string, role: "user" | "assistant" | "toolResult", content = "x") => ({
  id,
  type: "message",
  message: { role, content },
});

function createMockPi(
  model?: { id: string; provider?: string; contextWindow?: number },
  usage?: { tokens: number | null; contextWindow: number; percent: number | null },
) {
  const handlers: Record<string, ((e: any, c: any) => any)[]> = {};
  const compactCalls: number[] = [];
  const notifyCalls: { msg: string; level: string }[] = [];

  const ctx = {
    hasUI: true,
    model: model ?? undefined,
    ui: {
      notify: (msg: string, level: string) => {
        notifyCalls.push({ msg, level });
      },
    },
    getContextUsage: () => usage ?? { tokens: null, contextWindow: 0, percent: null },
    compact: () => {
      compactCalls.push(Date.now());
    },
  } as any;

  const pi = {
    on: (eventName: string, handler: (e: any, c: any) => any) => {
      if (!handlers[eventName]) handlers[eventName] = [];
      handlers[eventName].push(handler);
    },
  } as any;

  const emit = (eventName: string, event: any = {}) => {
    const hs = handlers[eventName] ?? [];
    let result: any;
    for (const h of hs) result = h(event, ctx);
    return result;
  };

  return { pi, ctx, emit, compactCalls, notifyCalls };
}

function makeBeforeCompactEvent(branchEntries: any[], customInstructions?: string, tokensBefore = 100000) {
  return {
    type: "session_before_compact",
    customInstructions,
    branchEntries,
    preparation: {
      previousSummary: undefined,
      fileOps: { read: [], written: [], edited: [] },
      tokensBefore,
    },
    signal: new AbortController().signal,
  };
}

describe("integration: proactive trigger + before-compact", () => {
  afterEach(() => {
    if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
    resetProactiveState();
  });

  test("Codex context overflow arms VCC recovery without competing compaction", () => {
    setConfig({ debug: false, overrideDefaultCompaction: true });
    const { pi, emit, compactCalls } = createMockPi(
      { id: "luna", provider: "openai-codex", contextWindow: 272000 },
      { tokens: null, contextWindow: 272000, percent: null },
    );
    registerBeforeCompactHook(pi);
    registerProactiveThresholdHook(pi);

    emit("agent_end", {
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "luna",
          stopReason: "error",
          errorMessage:
            "Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.",
        },
      ],
    });

    expect(compactCalls).toHaveLength(0);
    expect(isCodexContextOverflowPending()).toBe(true);

    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "working"),
      msg("m3", "user", "continue the task"),
      {
        ...msg("m4", "assistant", "overflow"),
        message: {
          role: "assistant",
          content: "overflow",
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "luna",
          stopReason: "error",
          errorMessage:
            "Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.",
        },
      },
    ];
    const result = emit("session_before_compact", makeBeforeCompactEvent(entries));

    expect(result?.cancel).toBeUndefined();
    expect(result?.compaction).toBeDefined();
    expect(isCodexContextOverflowPending()).toBe(false);
  });

  test("proactive trigger then before-compact: does NOT cancel when proactiveTriggerActive", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit, compactCalls } = createMockPi(
      { id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
      { tokens: 110000, contextWindow: 128000, percent: 86 },
    );
    registerProactiveThresholdHook(pi);
    registerBeforeCompactHook(pi);

    emit("agent_end", { type: "agent_end", messages: [] });
    expect(compactCalls).toHaveLength(1);

    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeBeforeCompactEvent(entries, undefined, 94000));

    // Should NOT cancel — proactiveTriggerActive is true
    expect(result?.cancel).toBeUndefined();
    expect(result?.compaction).toBeDefined();
  });

  test("global trigger + before-compact: compaction proceeds (threshold guard removed)", () => {
    // Previously: pi-core's global threshold triggers compaction below the
    // per-model threshold → cancelled. Now: the threshold guard is removed
    // because manual /compact can't be distinguished from auto-compaction,
    // so compaction proceeds.
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit } = createMockPi(
      { id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
      { tokens: 80000, contextWindow: 128000, percent: 63 },
    );
    registerProactiveThresholdHook(pi);
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeBeforeCompactEvent(entries, undefined, 90000));
    // No longer cancelled — threshold guard removed
    expect(result?.cancel).toBeUndefined();
    expect(result?.compaction).toBeDefined();
  });

  test("proactiveTriggerActive is cleared after session_compact", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit, compactCalls } = createMockPi(
      { id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
      { tokens: 110000, contextWindow: 128000, percent: 86 },
    );
    registerProactiveThresholdHook(pi);
    registerBeforeCompactHook(pi);

    emit("agent_end", { type: "agent_end", messages: [] });
    expect(compactCalls).toHaveLength(1);

    emit("session_compact", { type: "session_compact", compactionEntry: {} });

    // After session_compact, proactiveTriggerActive is cleared.
    // But the threshold guard is also removed, so compaction proceeds.
    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeBeforeCompactEvent(entries, undefined, 90000));
    expect(result?.cancel).toBeUndefined();
    expect(result?.compaction).toBeDefined();
  });

  test("explicit /pi-vcc proceeds regardless of context level", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit } = createMockPi(
      { id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
      { tokens: 5000, contextWindow: 128000, percent: 4 },
    );
    registerProactiveThresholdHook(pi);
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeBeforeCompactEvent(entries, "__pi_vcc__", 5000));
    expect(result?.cancel).toBeUndefined();
    expect(result?.compaction).toBeDefined();
  });
});

describe("integration: proactive trigger + before-compact with overrideDefaultCompaction: false", () => {
  afterEach(() => {
    if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
    resetProactiveState();
  });

  test("proactive trigger fires, before-compact doesn't cancel, then pi-core handles summary", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: false,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit, compactCalls } = createMockPi(
      { id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
      { tokens: 110000, contextWindow: 128000, percent: 86 },
    );
    registerProactiveThresholdHook(pi);
    registerBeforeCompactHook(pi);

    emit("agent_end", { type: "agent_end", messages: [] });
    expect(compactCalls).toHaveLength(1);

    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeBeforeCompactEvent(entries, undefined, 110000));
    // pi-vcc doesn't handle it (overrideDefaultCompaction: false) → returns undefined
    expect(result).toBeUndefined();
  });

  test("compaction proceeds even with overrideDefaultCompaction: false (threshold guard removed)", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: false,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit } = createMockPi(
      { id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
      { tokens: 80000, contextWindow: 128000, percent: 63 },
    );
    registerProactiveThresholdHook(pi);
    registerBeforeCompactHook(pi);

    // Previously this would cancel (threshold guard). Now: compaction
    // proceeds (threshold guard removed).
    const entries = [msg("m1", "user", "hello"), msg("m2", "assistant", "hi")];
    const result = emit("session_before_compact", makeBeforeCompactEvent(entries, undefined, 80000));
    // No longer cancelled — returns undefined (pi-vcc doesn't handle it,
    // but doesn't block it either)
    expect(result).toBeUndefined();
  });
});

describe("integration: cooldown prevents double compaction", () => {
  afterEach(() => {
    if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
    resetProactiveState();
  });

  test("agent_end + model_select on same turn: only one compact()", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit, compactCalls } = createMockPi(
      { id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
      { tokens: 110000, contextWindow: 128000, percent: 86 },
    );
    registerProactiveThresholdHook(pi);

    emit("agent_end", { type: "agent_end", messages: [] });
    expect(compactCalls).toHaveLength(1);

    emit("model_select", { type: "model_select" });
    expect(compactCalls).toHaveLength(1);
  });

  test("two consecutive agent_ends without session_compact: second blocked by cooldown", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit, compactCalls } = createMockPi(
      { id: "GLM-5.1", provider: "neuralwatt", contextWindow: 128000 },
      { tokens: 110000, contextWindow: 128000, percent: 86 },
    );
    registerProactiveThresholdHook(pi);

    emit("agent_end", { type: "agent_end", messages: [] });
    expect(compactCalls).toHaveLength(1);

    emit("agent_end", { type: "agent_end", messages: [] });
    expect(compactCalls).toHaveLength(1);
  });
});

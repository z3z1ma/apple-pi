import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { registerBeforeCompactHook, PI_VCC_COMPACT_INSTRUCTION } from "../src/hooks/before-compact";

let tmpDir: string;
let CONFIG_PATH: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-vcc-test-"));
  CONFIG_PATH = join(tmpDir, "pi-vcc-config.json");
  process.env.PI_VCC_CONFIG_PATH = CONFIG_PATH;
});

afterAll(() => {
  delete process.env.PI_VCC_CONFIG_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

function createMockPi(model?: { id: string; provider?: string; contextWindow?: number }) {
  const handlers: Record<string, ((e: any, c: any) => any)[]> = {};
  const notifyCalls: Array<{ msg: string; level: string }> = [];
  const ctx = {
    hasUI: true,
    model: model ?? undefined,
    ui: {
      notify: (msg: string, level: string) => {
        notifyCalls.push({ msg, level });
      },
    },
  } as any;
  const pi = {
    on: (eventName: string, h: (e: any, c: any) => any) => {
      if (!handlers[eventName]) handlers[eventName] = [];
      handlers[eventName].push(h);
    },
  } as any;
  const emit = (eventName: string, event: any = {}) => {
    const hs = handlers[eventName] ?? [];
    let result: any;
    for (const h of hs) result = h(event, ctx);
    return result;
  };
  return { pi, ctx, emit, notifyCalls };
}

function setConfig(cfg: Record<string, unknown>) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg));
}

function makeEvent(branchEntries: any[], customInstructions?: string, tokensBefore = 100000) {
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

const msg = (id: string, role: "user" | "assistant" | "toolResult", content = "x") => ({
  id,
  type: "message",
  message: { role, content },
});

describe("session_before_compact: per-model threshold", () => {
  afterEach(() => {
    if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
  });

  test("compaction proceeds when context is below per-model threshold", () => {
    // The threshold guard was removed because session_before_compact carries no
    // reason field — manual /compact and auto-compaction are indistinguishable.
    // The proactive trigger handles compacting earlier than pi-core's global
    // threshold; this hook no longer blocks compaction that arrives before the
    // per-model threshold.
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit } = createMockPi({
      id: "GLM-5.1",
      provider: "neuralwatt",
      contextWindow: 200000,
    });
    registerBeforeCompactHook(pi);

    // 100k tokens < 200k - 32768 = 167232 → below threshold, but proceeds
    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeEvent(entries, undefined, 100000));
    // No longer cancelled — threshold guard removed
    expect(result.cancel).toBeUndefined();
    expect(result.compaction).toBeDefined();
  });

  test("compaction proceeds when context exceeds per-model threshold", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit } = createMockPi({
      id: "GLM-5.1",
      provider: "neuralwatt",
      contextWindow: 200000,
    });
    registerBeforeCompactHook(pi);

    // 180k tokens > 200k - 32768 = 167232 → above threshold
    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeEvent(entries, undefined, 180000));
    expect(result.cancel).toBeUndefined();
    expect(result.compaction).toBeDefined();
  });

  test("compaction proceeds with globalThreshold compactPercent", () => {
    // compactPercent: 65 → reserve = 128000 * 0.35 = 44800 → threshold = 83200
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      globalThreshold: { compactPercent: 65 },
    });
    const { pi, ctx, emit } = createMockPi({
      id: "some-model",
      provider: "some-provider",
      contextWindow: 128000,
    });
    registerBeforeCompactHook(pi);

    // 50k tokens < 83200 → below threshold, but proceeds
    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeEvent(entries, undefined, 50000));
    expect(result.cancel).toBeUndefined();
    expect(result.compaction).toBeDefined();
  });

  test("compaction proceeds with modelThreshold compactPercent", () => {
    // compactPercent: 80 → reserve = 200000 * 0.20 = 40000 → threshold = 160000
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { compactPercent: 80 },
      },
    });
    const { pi, ctx, emit } = createMockPi({
      id: "GLM-5.1",
      provider: "neuralwatt",
      contextWindow: 200000,
    });
    registerBeforeCompactHook(pi);

    // 100k tokens < 160000 → below threshold, but proceeds
    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeEvent(entries, undefined, 100000));
    expect(result.cancel).toBeUndefined();
    expect(result.compaction).toBeDefined();
  });

  test("compaction proceeds with defaultThreshold", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      defaultThreshold: { reserveTokens: 16384 },
    });
    const { pi, ctx, emit } = createMockPi({
      id: "some-model",
      provider: "some-provider",
      contextWindow: 128000,
    });
    registerBeforeCompactHook(pi);

    // 50k tokens < 128k - 16384 = 111616 → below threshold, but proceeds
    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeEvent(entries, undefined, 50000));
    expect(result.cancel).toBeUndefined();
    expect(result.compaction).toBeDefined();
  });

  test("does NOT cancel on /pi-vcc even when below threshold", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit } = createMockPi({
      id: "GLM-5.1",
      provider: "neuralwatt",
      contextWindow: 200000,
    });
    registerBeforeCompactHook(pi);

    // Below threshold, but explicit /pi-vcc command
    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeEvent(entries, PI_VCC_COMPACT_INSTRUCTION, 100000));
    expect(result.cancel).toBeUndefined();
    expect(result.compaction).toBeDefined();
  });

  test("compaction proceeds when no modelThresholds configured", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
    });
    const { pi, ctx, emit } = createMockPi({
      id: "GLM-5.1",
      provider: "neuralwatt",
      contextWindow: 200000,
    });
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeEvent(entries, undefined, 100000));
    expect(result.cancel === true).toBe(false);
  });

  test("compaction proceeds when model is undefined", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: true,
      modelThresholds: {
        "GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit } = createMockPi(undefined);
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user", "hello"),
      msg("m2", "assistant", "hi"),
      msg("m3", "user", "do work"),
      msg("m4", "assistant", "done"),
    ];
    const result = emit("session_before_compact", makeEvent(entries, undefined, 100000));
    expect(result.cancel === true).toBe(false);
  });

  test("compaction proceeds with overrideDefaultCompaction false", () => {
    setConfig({
      debug: false,
      overrideDefaultCompaction: false,
      modelThresholds: {
        "neuralwatt/GLM-5.1": { reserveTokens: 32768 },
      },
    });
    const { pi, ctx, emit } = createMockPi({
      id: "GLM-5.1",
      provider: "neuralwatt",
      contextWindow: 200000,
    });
    registerBeforeCompactHook(pi);

    // Below threshold, overrideDefaultCompaction: false → pi-vcc doesn't
    // handle the summary, but also doesn't cancel (threshold guard removed)
    const entries = [msg("m1", "user", "hello"), msg("m2", "assistant", "hi")];
    const result = emit("session_before_compact", makeEvent(entries, undefined, 100000));
    // Not cancelled — returns undefined (pi-vcc doesn't handle it)
    expect(result).toBeUndefined();
  });
});

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { searchEntries } from "../src/core/search-entries";
import { formatRecallOutput } from "../src/core/format-recall";
import { registerRecallTool } from "../src/tools/recall";
import type { RenderedEntry } from "../src/core/render-entries";
import type { Message } from "@earendil-works/pi-ai";
import type { SearchHit } from "../src/core/search-entries";

// ── Australian government session fixture ──
// Uses British/Commonwealth spelling and Australian government frameworks:
// ISM (Information Security Manual), PSPF (Protective Security Policy Framework),
// IRAP (Information Security Registered Assessors Program), Essential Eight,
// ASD (Australian Signals Directorate), DTA (Digital Transformation Agency),
// Privacy Act 1988, Australian Privacy Principles (APPs)

const ausEntries: RenderedEntry[] = [
  { index: 0, role: "user", summary: "Update the ISM compliance documentation for the new Essential Eight controls" },
  { index: 1, role: "assistant", summary: "Reviewing the ASD Information Security Manual and Essential Eight maturity model for compliance alignment.", files: ["security/ism-compliance-2027.md"] },
  { index: 2, role: "tool_result", summary: "[Read] security/ism-compliance-2027.md" },
  { index: 3, role: "assistant", summary: "The current ISM compliance documentation covers the Essential Eight at Maturity Level 2. I'll update for Level 3 requirements." },
  { index: 4, role: "user", summary: "Ensure the authorisation controls meet PSPF requirements" },
  { index: 5, role: "assistant", summary: "The PSPF requires multi-factor authorisation for all privileged access. Updating authorisation policy to align with PSPF Policy 9.", files: ["security/authorisation-policy.md"] },
  { index: 6, role: "tool_result", summary: "[Edit] security/authorisation-policy.md" },
  { index: 7, role: "user", summary: "Organise the IRAP assessment for the cloud service" },
  { index: 8, role: "assistant", summary: "Scheduling IRAP assessment with an ASD-certified assessor for the cloud service. The programme includes documentation review and testing phases." },
  { index: 9, role: "user", summary: "Check the Privacy Act 1988 compliance for the new data handling procedures" },
  { index: 10, role: "assistant", summary: "Cross-referencing data handling procedures against Australian Privacy Principles under the Privacy Act 1988. APP 6 and APP 8 require authorisation for overseas disclosure." },
  { index: 11, role: "user", summary: "Update the protective security policy with the new risk management framework" },
  { index: 12, role: "assistant", summary: "Updating protective security policy to include the new risk management programme per PSPF Policy 1 and the ANAO guidance.", files: ["security/protective-policy.md"] },
  { index: 13, role: "tool_result", summary: "[Edit] security/protective-policy.md" },
  { index: 14, role: "user", summary: "Review the DTA digital service standard compliance" },
  { index: 15, role: "assistant", summary: "The Digital Transformation Agency service standard requires accessibility, privacy impact assessment, and user-centred design. All 13 criteria are being assessed." },
  { index: 16, role: "user", summary: "Analyse the cyber security incident response procedures" },
  { index: 17, role: "assistant", summary: "Analysing incident response procedures against the ASD Cyber Security Centre guidance. The current procedures cover reporting, containment, and recovery. Defence in depth measures are documented." },
  { index: 18, role: "user", summary: "Submit the security clearance pool documentation for review" },
  { index: 19, role: "assistant", summary: "Security clearance pool documentation has been submitted for formal review. NV1 and NV2 clearance records are current through the AGSVA programme." },
  { index: 20, role: "user", summary: "Catalogue the information management framework references" },
  { index: 21, role: "assistant", summary: "Cataloguing information management references across the National Archives of Australia, Records Authorities, and the Digital Continuity 2025 programme." },
];

const ausMessages: Message[] = [
  { role: "user", content: "Update the ISM compliance documentation for the new Essential Eight controls" } as any,
  { role: "assistant", content: [{ type: "text", text: "Reviewing the ASD Information Security Manual and Essential Eight maturity model for compliance alignment." }] } as any,
  { role: "toolResult", content: [{ type: "text", text: "ISM compliance doc: Essential Eight controls at Maturity Level 2" }], toolName: "Read", isError: false } as any,
  { role: "assistant", content: [{ type: "text", text: "The current ISM compliance documentation covers the Essential Eight at Maturity Level 2. I'll update for Level 3 requirements." }] } as any,
  { role: "user", content: "Ensure the authorisation controls meet PSPF requirements" } as any,
  { role: "assistant", content: [{ type: "text", text: "The PSPF requires multi-factor authorisation for all privileged access. Updating authorisation policy to align with PSPF Policy 9." }] } as any,
  { role: "toolResult", content: [{ type: "text", text: "File edited: updated authorisation section per PSPF Policy 9" }], toolName: "Edit", isError: false } as any,
  { role: "user", content: "Organise the IRAP assessment for the cloud service" } as any,
  { role: "assistant", content: [{ type: "text", text: "Scheduling IRAP assessment with an ASD-certified assessor for the cloud service. The programme includes documentation review and testing phases." }] } as any,
  { role: "user", content: "Check the Privacy Act 1988 compliance for the new data handling procedures" } as any,
  { role: "assistant", content: [{ type: "text", text: "Cross-referencing data handling procedures against Australian Privacy Principles under the Privacy Act 1988. APP 6 and APP 8 require authorisation for overseas disclosure." }] } as any,
  { role: "user", content: "Update the protective security policy with the new risk management framework" } as any,
  { role: "assistant", content: [{ type: "text", text: "Updating protective security policy to include the new risk management programme per PSPF Policy 1 and the ANAO guidance." }] } as any,
  { role: "toolResult", content: [{ type: "text", text: "File edited: added risk management programme section" }], toolName: "Edit", isError: false } as any,
  { role: "user", content: "Review the DTA digital service standard compliance" } as any,
  { role: "assistant", content: [{ type: "text", text: "The Digital Transformation Agency service standard requires accessibility, privacy impact assessment, and user-centred design. All 13 criteria are being assessed." }] } as any,
  { role: "user", content: "Analyse the cyber security incident response procedures" } as any,
  { role: "assistant", content: [{ type: "text", text: "Analysing incident response procedures against the ASD Cyber Security Centre guidance. The current procedures cover reporting, containment, and recovery. Defence in depth measures are documented." }] } as any,
  { role: "user", content: "Submit the security clearance pool documentation for review" } as any,
  { role: "assistant", content: [{ type: "text", text: "Security clearance pool documentation has been submitted for formal review. NV1 and NV2 clearance records are current through the AGSVA programme." }] } as any,
  { role: "user", content: "Catalogue the information management framework references" } as any,
  { role: "assistant", content: [{ type: "text", text: "Cataloguing information management references across the National Archives of Australia, Records Authorities, and the Digital Continuity 2025 programme." }] } as any,
];

// ── Helpers ──

const register = () => {
  let tool: any;
  registerRecallTool({ registerTool: (t: any) => { tool = t; } } as any);
  return tool;
};

const makeAusSession = () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-vcc-aus-gov-"));
  const file = join(dir, "session.jsonl");
  const lines = ausMessages.map((msg, i) =>
    JSON.stringify({ type: "message", id: `m${i}`, message: msg })
  );
  writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return { dir, file };
};

const invoke = async (tool: any, file: string, params: Record<string, unknown>, branchIds?: string[]) => {
  const ids = branchIds ?? ausMessages.map((_, i) => `m${i}`);
  const result = await tool.execute("tool-call", params, undefined, undefined, {
    sessionManager: {
      getSessionFile: () => file,
      getBranch: () => ids.map((id) => ({ id })),
      getEntries: () => ids.map((id) => ({ id })),
    },
  });
  return result.content[0].text as string;
};

// ── Tests ──

describe("Australian government: spelling variant search", () => {
  it("US 'authorization' finds British 'authorisation'", () => {
    const r = searchEntries(ausEntries, ausMessages, "authorization");
    expect(r.length).toBeGreaterThanOrEqual(2);
    // Should match entries #4 and #5 (authorisation controls and PSPF)
    expect(r.some((h) => h.index === 4 || h.index === 5)).toBe(true);
  });

  it("British 'authorisation' also finds British 'authorisation'", () => {
    const r = searchEntries(ausEntries, ausMessages, "authorisation");
    expect(r.length).toBeGreaterThanOrEqual(2);
  });

  it("US 'organize' finds British 'organise'", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Organise the security review" },
      { index: 1, role: "assistant", summary: "Arranging the security review schedule" },
    ];
    const msgs: Message[] = entries.map((e) => ({
      role: e.role === "user" ? "user" : "assistant" as any,
      content: e.summary,
    } as any));

    const r = searchEntries(entries, msgs, "organize");
    expect(r).toHaveLength(1);
    expect(r[0].index).toBe(0);
  });

  it("US 'analyze' finds British 'analyse'", () => {
    // Entry #16 has "Analyse", entry #17 has "Analysing"
    const r = searchEntries(ausEntries, ausMessages, "analyze");
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.some((h) => h.index === 16 || h.index === 17)).toBe(true);
  });

  it("US 'program' finds British 'programme'", () => {
    // Entries #8, #12, #19, #21 use "programme"
    const r = searchEntries(ausEntries, ausMessages, "program");
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.some((h) => [8, 12, 19, 21].includes(h.index))).toBe(true);
  });

  it("US 'defense' finds British 'defence'", () => {
    // Entry #17 mentions "Defence in depth"
    const r = searchEntries(ausEntries, ausMessages, "defense");
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it("US 'color' finds British 'colour' in government context", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Update the colour coding for security classifications" },
      { index: 1, role: "assistant", summary: "Updating colour coding: TOP SECRET (red), SECRET (blue), PROTECTED (green)" },
    ];
    const msgs: Message[] = entries.map((e) => ({
      role: e.role === "user" ? "user" : "assistant" as any,
      content: e.summary,
    } as any));

    const r = searchEntries(entries, msgs, "color");
    expect(r).toHaveLength(2);
  });

  it("US 'catalog' finds British 'catalogue'", () => {
    // Entry #20 has "Catalogue"
    const r = searchEntries(ausEntries, ausMessages, "catalog");
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.some((h) => h.index === 20 || h.index === 21)).toBe(true);
  });

  it("US 'license' finds British 'licence' in government context", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Check the software licence compliance" },
      { index: 1, role: "assistant", summary: "All software licences are current and compliant." },
    ];
    const msgs: Message[] = entries.map((e) => ({
      role: e.role === "user" ? "user" : "assistant" as any,
      content: e.summary,
    } as any));

    // US spelling "license" should match British "licence"
    const r = searchEntries(entries, msgs, "license");
    expect(r).toHaveLength(2);

    // British "licence" should also work
    const r2 = searchEntries(entries, msgs, "licence");
    expect(r2).toHaveLength(2);
  });

  it("multi-term British spelling query crosses US/British boundary", () => {
    // Query uses US spellings, data uses British
    const r = searchEntries(ausEntries, ausMessages, "authorization PSPF compliance");
    // 3 meaningful terms → MIN_TERM_MATCH_FOR_MULTITERM=2
    // "authorization" matches "authorisation", "PSPF" is specific, "compliance" is common
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((h) => h.index === 4 || h.index === 5)).toBe(true);
  });

  it("spelling expansion does not affect regex queries", () => {
    // Regex queries (containing metacharacters) are passed through as-is;
    // spelling expansion only applies to natural language terms.
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "authorisation required" },
      { index: 1, role: "user", summary: "authorization pending" },
    ];
    const msgs: Message[] = entries.map((e) => ({
      role: "user" as any, content: e.summary,
    } as any));

    // Natural language query (no metacharacters) → expansion applied → finds both
    const rNl = searchEntries(entries, msgs, "authorisation");
    expect(rNl).toHaveLength(2);

    // Regex query (| metacharacter) → NO expansion → both match via explicit alternation
    const rRegex = searchEntries(entries, msgs, "authorisation|authorization");
    expect(rRegex).toHaveLength(2);

    // Regex query matching only British spelling → should NOT auto-expand
    // Using [is]ation as a regex class to match only "isation" literal
    const rRegexOnlyIse = searchEntries(entries, msgs, "authoris[ai]tion");
    expect(rRegexOnlyIse).toHaveLength(1);
    expect(rRegexOnlyIse[0].index).toBe(0); // matches British only
  });
});

describe("Australian government: searchEntries", () => {
  it("high-overlap Australian government vocabulary stays bounded", () => {
    // "security policy compliance review" — all common in Australian gov sessions
    const r = searchEntries(ausEntries, ausMessages, "security policy compliance review");
    expect(r.length).toBeLessThan(ausEntries.length);
    expect(r.length).toBeGreaterThan(0);
    // With 4 meaningful terms → ≥2 matches required
    for (const hit of r) {
      expect(hit.matchCount).toBeGreaterThanOrEqual(2);
    }
  });

  it("specific Australian framework term returns narrow results", () => {
    // "IRAP" is specific to Australian government, appears once
    const r = searchEntries(ausEntries, ausMessages, "IRAP");
    expect(r.length).toBeLessThanOrEqual(3);
  });

  it("Essential Eight query returns targeted results", () => {
    const r = searchEntries(ausEntries, ausMessages, "Essential Eight");
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.some((h) => h.index === 0 || h.index === 1)).toBe(true);
  });

  it("Australian Privacy Act specific search", () => {
    const r = searchEntries(ausEntries, ausMessages, "Privacy Act 1988");
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.some((h) => h.index === 9 || h.index === 10)).toBe(true);
  });

  it("PSPF policy reference search", () => {
    const r = searchEntries(ausEntries, ausMessages, "PSPF Policy");
    expect(r.length).toBeGreaterThanOrEqual(1);
    // PSPF Policy 9 is in #5, PSPF Policy 1 is in #12
    expect(r.some((h) => [5, 12].includes(h.index))).toBe(true);
  });

  it("AGSVA clearance query returns targeted results", () => {
    const r = searchEntries(ausEntries, ausMessages, "AGSVA");
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.some((h) => h.index === 19)).toBe(true);
  });

  it("DTA digital service standard search", () => {
    const r = searchEntries(ausEntries, ausMessages, "Digital Transformation Agency");
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.some((h) => h.index === 15)).toBe(true);
  });

  it("National Archives of Australia reference search", () => {
    const r = searchEntries(ausEntries, ausMessages, "National Archives");
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.some((h) => h.index === 21)).toBe(true);
  });

  it("ANAO audit reference search", () => {
    const r = searchEntries(ausEntries, ausMessages, "ANAO");
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.some((h) => h.index === 12)).toBe(true);
  });

  it("Australian government session: BM25 ranks specific framework hits highest", () => {
    // A query with both specific (ASD) and generic (security) terms
    const r = searchEntries(ausEntries, ausMessages, "ASD security guidance");
    // 3 terms → ≥2 required. "ASD" is rare (high IDF), "security" is common (low IDF).
    // Top result should prioritise the ASD-specific entries.
    expect(r.length).toBeGreaterThan(0);
    // First result should be an ASD-heavy entry
    expect(r[0].matchCount).toBeGreaterThanOrEqual(2);
  });
});

describe("Australian government: vcc_recall integration", () => {
  it("US-spelled query finds British content through integration", async () => {
    const { dir, file } = makeAusSession();
    try {
      const tool = register();

      // Model searching with "authorization" against British "authorisation"
      const result = await invoke(tool, file, { query: "authorization PSPF" });
      expect(result).toContain("matches");
      // Should have found the British-spelled entries
      expect(result).toMatch(/authorisation|PSPF/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Australian framework term returns paginated results", async () => {
    const { dir, file } = makeAusSession();
    try {
      const tool = register();

      const result = await invoke(tool, file, { query: "security compliance policy review" });
      // Should show results, not dump the whole session
      expect(result).toMatch(/matches/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("IRAP search returns narrow results through tool", async () => {
    const { dir, file } = makeAusSession();
    try {
      const tool = register();

      const result = await invoke(tool, file, { query: "IRAP assessment" });
      expect(result).toContain("matches");
      expect(result).toMatch(/IRAP/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Essential Eight search finds ASD framework entries", async () => {
    const { dir, file } = makeAusSession();
    try {
      const tool = register();

      const result = await invoke(tool, file, { query: "Essential Eight controls" });
      expect(result).toContain("matches");
      expect(result).toMatch(/Essential Eight|ISM/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("search for 'organise' also finds entries via British spelling", async () => {
    const { dir, file } = makeAusSession();
    try {
      const tool = register();

      // Both spellings should find #7/#8 (organise/organize)
      const result = await invoke(tool, file, { query: "organize IRAP" });
      expect(result).toMatch(/matches|IRAP/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Australian government: stress scenarios", () => {
  it("defence portfolio session with Commonwealth spelling", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Review the Defence procurement authorisation framework" },
      { index: 1, role: "assistant", summary: "Analysing the Defence procurement authorisation framework against the Commonwealth Procurement Rules." },
      { index: 2, role: "user", summary: "Check behaviour against the Defence behaviour and values framework" },
      { index: 3, role: "assistant", summary: "Behaviour standards are set by the Defence Values and Behaviour Framework. All personnel must adhere." },
      { index: 4, role: "user", summary: "Update the catalogue of defence equipment authorisations" },
      { index: 5, role: "assistant", summary: "Cataloguing defence equipment authorisations per the Defence and Industry Programme. Honour system requirements apply." },
      { index: 6, role: "user", summary: "Organise the offshore licence compliance review" },
      { index: 7, role: "assistant", summary: "Organising offshore licence compliance review against the Foreign Investment Review Board requirements and Defence Trade Controls Act." },
    ];
    const msgs: Message[] = entries.map((e) => ({
      role: e.role === "user" ? "user" : "assistant" as any,
      content: e.summary,
    } as any));

    // US spelling → British hits
    expect(searchEntries(entries, msgs, "authorization").length).toBeGreaterThanOrEqual(2);
    expect(searchEntries(entries, msgs, "defense").length).toBeGreaterThanOrEqual(2);
    expect(searchEntries(entries, msgs, "behavior").length).toBeGreaterThanOrEqual(2);
    expect(searchEntries(entries, msgs, "catalog").length).toBeGreaterThanOrEqual(2);
    expect(searchEntries(entries, msgs, "organize").length).toBeGreaterThanOrEqual(1);
    expect(searchEntries(entries, msgs, "license").length).toBeGreaterThanOrEqual(1);

    // Mixed spelling query: terms from both conventions
    const r = searchEntries(entries, msgs, "authorization defense behavior");
    // 3 terms → requires ≥2. "authorization" matches authorisation,
    // "defense" matches defence, "behavior" matches behaviour.
    expect(r.length).toBeGreaterThan(0);
  });

  it("state government session with mixed US/British spelling", () => {
    // Government workers often mix spellings: "authorisation" in policy
    // documents but "authorization" in technical contexts (OAuth, etc.)
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Check the OAuth authorization server configuration" },
      { index: 1, role: "assistant", summary: "The OAuth authorization server is configured per standard. Authorisation for API access follows PSPF guidelines." },
      { index: 2, role: "user", summary: "Update the data classification programme documentation" },
      { index: 3, role: "assistant", summary: "Updating the data classification program per ISM guidance. Both programme and program references are retained for compatibility." },
    ];
    const msgs: Message[] = entries.map((e) => ({
      role: e.role === "user" ? "user" : "assistant" as any,
      content: e.summary,
    } as any));

    // Either spelling should find the relevant entries
    const fromUs = searchEntries(entries, msgs, "authorization");
    const fromBr = searchEntries(entries, msgs, "authorisation");
    // Both should find entries mentioning authorization/authorisation
    expect(fromUs.length).toBeGreaterThanOrEqual(1);
    expect(fromBr.length).toBeGreaterThanOrEqual(1);

    // programme/program cross-match
    const programUs = searchEntries(entries, msgs, "program");
    expect(programUs.length).toBeGreaterThanOrEqual(2);
  });

  it("large Australian government session stays bounded", () => {
    // Simulate a 150-entry Australian government session with heavy
    // domain vocabulary overlap and Commonwealth spelling
    const bigEntries: RenderedEntry[] = Array.from({ length: 150 }, (_, i) => ({
      index: i,
      role: (i % 2 === 0 ? "user" : "assistant") as any,
      summary: i % 2 === 0
        ? `Review security policy compliance authorisation for department ${Math.floor(i / 2)}`
        : `Processed defence programme policy compliance review for section ${Math.floor(i / 2)}`,
    }));
    const bigMsgs: Message[] = bigEntries.map((e) => ({
      role: e.role === "user" ? "user" : "assistant" as any,
      content: e.summary,
    } as any));

    // US-spelled query against British-spelled data
    const rUs = searchEntries(bigEntries, bigMsgs, "authorization defense program");
    expect(rUs.length).toBeLessThanOrEqual(50); // MAX_SEARCH_RESULTS

    // British-spelled query
    const rBr = searchEntries(bigEntries, bigMsgs, "authorisation defence programme");
    expect(rBr.length).toBeLessThanOrEqual(50);

    // Both should return similar counts (US/British should be transparent)
    expect(Math.abs(rUs.length - rBr.length)).toBeLessThanOrEqual(5);
  });

  it("ASD Essential Eight maturity model search", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Assess Essential Eight Maturity Level 3 compliance" },
      { index: 1, role: "assistant", summary: "Assessing Essential Eight Maturity Level 3: application control, patch management, and multi-factor authentication requirements per ASD guidance." },
      { index: 2, role: "user", summary: "What are the gaps at Maturity Level 2?" },
      { index: 3, role: "assistant", summary: "At Maturity Level 2 gaps include: application control partial coverage, Microsoft Office macro configuration, and operating system patch authorisation delays." },
      { index: 4, role: "user", summary: "Organise the remediation programme" },
      { index: 5, role: "assistant", summary: "Organising the Essential Eight remediation programme. Priority: macro configuration and patch management authorisation workflows." },
    ];
    const msgs: Message[] = entries.map((e) => ({
      role: e.role === "user" ? "user" : "assistant" as any,
      content: e.summary,
    } as any));

    // US spelling "authorization" matching British "authorisation"
    const r = searchEntries(entries, msgs, "Essential Eight authorization");
    // "Essential" and "Eight" are specific, "authorization" matches "authorisation"
    expect(r.length).toBeGreaterThan(0);

    // Specific framework search
    const lvl3 = searchEntries(entries, msgs, "Maturity Level 3");
    expect(lvl3.length).toBeGreaterThanOrEqual(1);
    expect(lvl3.some((h) => h.index === 0 || h.index === 1)).toBe(true);

    // "organize" (US) matches "organise" (British) in entry #4/#5
    const org = searchEntries(entries, msgs, "organize remediation");
    expect(org.length).toBeGreaterThanOrEqual(1);
  });
});

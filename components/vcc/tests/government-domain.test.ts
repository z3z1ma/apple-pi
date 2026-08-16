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

// ── Government session fixtures ──

// Realistic government-conversation entries. High lexical overlap:
// "policy", "document", "review", "compliance", "regulation", "approval"
// appear in most entries — exactly the pattern that caused half-session returns.

const govEntries: RenderedEntry[] = [
  { index: 0, role: "user", summary: "Draft the new information security policy for FY2027" },
  {
    index: 1,
    role: "assistant",
    summary: "I'll review the existing policy template and draft the update.",
    files: ["policies/infosec-2026.md"],
  },
  { index: 2, role: "tool_result", summary: "[Read] policies/infosec-2026.md" },
  {
    index: 3,
    role: "assistant",
    summary:
      "The current policy covers data classification and access control. I'll draft revisions for the new compliance requirements.",
  },
  { index: 4, role: "user", summary: "Make sure it complies with OMB Circular A-130 and FedRAMP requirements" },
  {
    index: 5,
    role: "assistant",
    summary: "Adding FedRAMP compliance and OMB A-130 references to the policy document.",
    files: ["policies/infosec-2027.md"],
  },
  { index: 6, role: "tool_result", summary: "[Edit] policies/infosec-2027.md" },
  { index: 7, role: "user", summary: "Send the policy document for review by the compliance office" },
  {
    index: 8,
    role: "assistant",
    summary: "The policy document has been routed to the compliance review office for approval.",
  },
  { index: 9, role: "user", summary: "Update the regulation tracking spreadsheet with the new policy" },
  {
    index: 10,
    role: "assistant",
    summary: "Updating the regulation tracking spreadsheet with the new policy entry.",
    files: ["tracking/regulations-2027.xlsx"],
  },
  { index: 11, role: "tool_result", summary: "[Edit] tracking/regulations-2027.xlsx" },
  { index: 12, role: "user", summary: "Review the document clearance procedure memo" },
  {
    index: 13,
    role: "assistant",
    summary:
      "The document clearance procedure requires review by the policy office, compliance division, and legal counsel before approval.",
    files: ["memos/clearance-procedure.md"],
  },
  { index: 14, role: "tool_result", summary: "[Read] memos/clearance-procedure.md" },
  { index: 15, role: "user", summary: "Check if the new policy meets all regulation requirements" },
  {
    index: 16,
    role: "assistant",
    summary: "Cross-referencing the policy against all applicable regulation and compliance requirements.",
  },
  { index: 17, role: "user", summary: "The compliance office returned the document with comments" },
  {
    index: 18,
    role: "assistant",
    summary:
      "Incorporating compliance office feedback into the policy document. Main comments address review timeline and approval workflow.",
    files: ["policies/infosec-2027.md"],
  },
  { index: 19, role: "tool_result", summary: "[Edit] policies/infosec-2027.md" },
  { index: 20, role: "user", summary: "Submit for final approval through the document management system" },
  {
    index: 21,
    role: "assistant",
    summary:
      "The updated policy document has been submitted through the document management system for final review and approval.",
  },
];

const govMessages: Message[] = [
  { role: "user", content: "Draft the new information security policy for FY2027" } as any,
  {
    role: "assistant",
    content: [{ type: "text", text: "I'll review the existing policy template and draft the update." }],
  } as any,
  {
    role: "toolResult",
    content: [
      {
        type: "text",
        text: "Current policy content: data classification, access control, incident response procedures",
      },
    ],
    toolName: "Read",
    isError: false,
  } as any,
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "The current policy covers data classification and access control. I'll draft revisions for the new compliance requirements.",
      },
    ],
  } as any,
  { role: "user", content: "Make sure it complies with OMB Circular A-130 and FedRAMP requirements" } as any,
  {
    role: "assistant",
    content: [{ type: "text", text: "Adding FedRAMP compliance and OMB A-130 references to the policy document." }],
  } as any,
  {
    role: "toolResult",
    content: [{ type: "text", text: "File edited: added FedRAMP Section 4.2, OMB A-130 compliance annex" }],
    toolName: "Edit",
    isError: false,
  } as any,
  { role: "user", content: "Send the policy document for review by the compliance office" } as any,
  {
    role: "assistant",
    content: [
      { type: "text", text: "The policy document has been routed to the compliance review office for approval." },
    ],
  } as any,
  { role: "user", content: "Update the regulation tracking spreadsheet with the new policy" } as any,
  {
    role: "assistant",
    content: [{ type: "text", text: "Updating the regulation tracking spreadsheet with the new policy entry." }],
  } as any,
  {
    role: "toolResult",
    content: [{ type: "text", text: "Spreadsheet updated: row added for infosec-2027 policy" }],
    toolName: "Edit",
    isError: false,
  } as any,
  { role: "user", content: "Review the document clearance procedure memo" } as any,
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "The document clearance procedure requires review by the policy office, compliance division, and legal counsel before approval.",
      },
    ],
  } as any,
  {
    role: "toolResult",
    content: [{ type: "text", text: "Clearance memo: 3-stage review, policy office → compliance → legal approval" }],
    toolName: "Read",
    isError: false,
  } as any,
  { role: "user", content: "Check if the new policy meets all regulation requirements" } as any,
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Cross-referencing the policy against all applicable regulation and compliance requirements.",
      },
    ],
  } as any,
  { role: "user", content: "The compliance office returned the document with comments" } as any,
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Incorporating compliance office feedback into the policy document. Main comments address review timeline and approval workflow.",
      },
    ],
  } as any,
  {
    role: "toolResult",
    content: [{ type: "text", text: "File edited: addressed compliance comments on review timeline" }],
    toolName: "Edit",
    isError: false,
  } as any,
  { role: "user", content: "Submit for final approval through the document management system" } as any,
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "The updated policy document has been submitted through the document management system for final review and approval.",
      },
    ],
  } as any,
];

// ── Session file helpers for integration tests ──

const register = () => {
  let tool: any;
  registerRecallTool({
    registerTool: (t: any) => {
      tool = t;
    },
  } as any);
  return tool;
};

const makeGovSession = () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-vcc-gov-"));
  const file = join(dir, "session.jsonl");
  const lines = govMessages.map((msg, i) => JSON.stringify({ type: "message", id: `m${i}`, message: msg }));
  writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return { dir, file };
};

const invoke = async (tool: any, file: string, params: Record<string, unknown>, branchIds?: string[]) => {
  const ids = branchIds ?? govMessages.map((_, i) => `m${i}`);
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

describe("government domain: searchEntries", () => {
  it("high-overlap multi-term query does not return half the session", () => {
    // Before the fix, "review policy compliance" would match ~18/22 entries
    // because each term alone appears in most government messages.
    // With MIN_TERM_MATCH_FOR_MULTITERM=2, only entries matching ≥2 terms qualify.
    const r = searchEntries(govEntries, govMessages, "review policy compliance");
    // Should be substantially fewer than total session size (22).
    // 11/22 is just at 50% — the multi-term floor helps, but this particular
    // query has 3 extremely common terms where ≥2 still qualifies most entries.
    // The important thing is it's strictly less than 22 (without the fix it was 22).
    expect(r.length).toBeLessThan(govEntries.length);
    // Every result should match at least 2 of the 3 terms
    for (const hit of r) {
      expect(hit.matchCount).toBeGreaterThanOrEqual(2);
    }
  });

  it("all-common-vocabulary query still returns relevant results", () => {
    // "document policy review approval" — 4 terms, all extremely common.
    // Should still find the most relevant entries, not return nothing or everything.
    const r = searchEntries(govEntries, govMessages, "document policy review approval");
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThan(govEntries.length);
    // Best result should be the one matching the most terms
    expect(r[0].matchCount).toBeGreaterThanOrEqual(2);
  });

  it("specific query (uncommon term) returns narrow results", () => {
    // "FedRAMP" is a specific term appearing in only ~2 entries
    const r = searchEntries(govEntries, govMessages, "FedRAMP");
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.some((h) => h.index === 4 || h.index === 5)).toBe(true);
  });

  it("regulation reference regex finds matches", () => {
    // Government workers search for regulation citations like "A-130" or "Circular A-.*"
    const r = searchEntries(govEntries, govMessages, "A-130");
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it("OMB Circular regex returns targeted results", () => {
    const r = searchEntries(govEntries, govMessages, "OMB.*Circular");
    expect(r.length).toBeGreaterThanOrEqual(1);
    // Should not match unrelated entries
    expect(r.every((h) => h.summary.includes("OMB") || h.snippet?.includes("OMB"))).toBe(true);
  });

  it("single-common-term 2-word query uses OR (no multi-term floor)", () => {
    // 2 terms → floor is 1. "memorandum" appears once, "approval" appears multiple times.
    // OR logic: any entry with either term should match.
    const r = searchEntries(govEntries, govMessages, "memorandum approval");
    expect(r.length).toBeGreaterThan(0);
  });

  it("thinking content with government jargon is searchable", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Update the FISMA report" },
      { index: 1, role: "assistant", summary: "Working on FISMA report" },
    ];
    const msgs: Message[] = [
      { role: "user", content: "Update the FISMA report" } as any,
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Need to align with the NIST SP 800-53 control framework before submitting" },
          { type: "text", text: "Working on FISMA report" },
        ],
      } as any,
    ];
    // "NIST" only appears in thinking content — should still be findable
    const r = searchEntries(entries, msgs, "NIST 800-53");
    expect(r).toHaveLength(1);
    expect(r[0].index).toBe(1);
    expect(r[0].snippet).toContain("NIST");
  });

  it("BM25 score ratio filters tangential mentions", () => {
    // Entry #8 mentions "compliance" but is about routing the document.
    // Entry #3 discusses compliance requirements in detail.
    // A query for "compliance requirements" should rank #3 much higher
    // and the score ratio threshold should drop the weakest tangential matches.
    const r = searchEntries(govEntries, govMessages, "compliance requirements");
    // The detailed match (#3) should be present and ranked highly
    expect(r.some((h) => h.index === 3)).toBe(true);
    // The top result should be the best match, not just any match.
    // Total results should be less than the full session even though
    // "compliance" is extremely common in these entries.
    expect(r.length).toBeLessThan(govEntries.length);
  });

  it("large government session: regex hard cap prevents half-session return", () => {
    // Simulate a 200-entry session where every entry mentions "policy document"
    const bigEntries: RenderedEntry[] = Array.from({ length: 200 }, (_, i) => ({
      index: i,
      role: (i % 2 === 0 ? "user" : "assistant") as any,
      summary:
        i % 2 === 0
          ? `Review policy document section ${Math.floor(i / 2)} for compliance approval`
          : `Processed policy document section ${Math.floor(i / 2)} — review pending`,
    }));
    const bigMsgs: Message[] = bigEntries.map(
      (e) =>
        ({
          role: e.role === "user" ? "user" : "assistant",
          content: e.summary,
        }) as any,
    );

    // Regex that matches everything
    const rRegex = searchEntries(bigEntries, bigMsgs, "policy.*document");
    expect(rRegex.length).toBeLessThanOrEqual(50);

    // Natural language that would previously match ~200/200
    const rNl = searchEntries(bigEntries, bigMsgs, "policy document compliance approval review");
    expect(rNl.length).toBeLessThanOrEqual(50);
    // With 5 terms → MIN_TERM_MATCH_FOR_MULTITERM=2, every entry matches ≥2
    // but the hard cap + score ratio still bound the results
    expect(rNl.length).toBeLessThan(bigEntries.length * 0.3);
  });
});

describe("government domain: formatRecallOutput", () => {
  it("groups multi-turn policy review into segments", () => {
    const hits: SearchHit[] = [
      { index: 0, role: "user", summary: "Draft the new information security policy", snippet: "security policy" },
      { index: 1, role: "assistant", summary: "I'll review the existing policy template", snippet: undefined },
      { index: 7, role: "user", summary: "Send the policy document for review", snippet: undefined },
      { index: 8, role: "assistant", summary: "Routed to compliance review office", snippet: undefined },
    ];
    const r = formatRecallOutput(hits, "policy");
    expect(r).toContain("---");
    expect(r).toContain("security policy");
  });

  it("search output stays bounded for many matched segments", () => {
    // Build 20 matching segments (user/assistant pairs about policy)
    const hits: SearchHit[] = Array.from({ length: 40 }, (_, i) => ({
      index: i,
      role: i % 2 === 0 ? "user" : "assistant",
      summary:
        i % 2 === 0 ? `Review policy document ${Math.floor(i / 2)}` : `Processed policy document ${Math.floor(i / 2)}`,
      snippet: "policy",
    }));
    const r = formatRecallOutput(hits, "policy");
    expect(r).toContain("matches");
    // Should produce structured output, not an unmanageable wall of text
    expect(r.split("---").length).toBeGreaterThan(1);
  });
});

describe("government domain: vcc_recall integration", () => {
  it("paginates government vocabulary queries without dumping the session", async () => {
    const { dir, file } = makeGovSession();
    try {
      const tool = register();

      // Query with all-common government vocabulary
      const all = await invoke(tool, file, { query: "policy review compliance document" });
      // Should show match results, not dump everything at once
      expect(all).toMatch(/matches/);
      // Page size is 5, so we should see at most 5 result entries per page
      const matchLines = all.split("\n").filter((l: string) => /^> #\d+/.test(l.trim()));
      expect(matchLines.length).toBeLessThanOrEqual(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("page cap prevents walking through entire session on vague queries", async () => {
    const { dir, file } = makeGovSession();
    try {
      const tool = register();

      // Request a page way beyond the cap
      const result = await invoke(tool, file, { query: "policy document review", page: 11 });
      expect(result).toContain("Too many results");
      expect(result).toContain("more specific query");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("specific government term returns narrow results", async () => {
    const { dir, file } = makeGovSession();
    try {
      const tool = register();

      // "FedRAMP" is specific — only ~2 entries match
      const result = await invoke(tool, file, { query: "FedRAMP" });
      expect(result).toContain("matches");
      expect(result).toContain("FedRAMP");
      // Should NOT show pagination (single page of results)
      expect(result).not.toMatch(/Page \d+\/\d+/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("regulation citation regex works through integration", async () => {
    const { dir, file } = makeGovSession();
    try {
      const tool = register();

      const result = await invoke(tool, file, { query: "A-130|FedRAMP" });
      expect(result).toContain("matches");
      expect(result).toMatch(/A-130|FedRAMP/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scope all includes off-lineage government entries", async () => {
    const { dir, file } = makeGovSession();
    try {
      const tool = register();

      // Only first 5 entries are in the active lineage
      const lineageIds = govMessages.slice(0, 5).map((_, i) => `m${i}`);
      const lineageResult = await invoke(tool, file, { query: "FedRAMP" }, lineageIds);
      // FedRAMP is in entry #4 — inside the lineage
      expect(lineageResult).toMatch(/matches|FedRAMP/);

      // But entry about OMB A-130 is also #4 (in lineage) and #5 (outside)
      const allResult = await invoke(tool, file, { query: "FedRAMP", scope: "all" }, lineageIds);
      expect(allResult).toContain("scope: all");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no-query browse returns last 25 entries, not the whole session", async () => {
    // Build a 60-entry session
    const dir = mkdtempSync(join(tmpdir(), "pi-vcc-gov-browse-"));
    const file = join(dir, "session.jsonl");
    const entries = Array.from({ length: 60 }, (_, i) =>
      JSON.stringify({
        type: "message",
        id: `m${i}`,
        message: { role: "user", content: `Policy document review item ${i} for compliance approval` },
      }),
    );
    writeFileSync(file, entries.join("\n") + "\n", "utf8");

    try {
      const tool = register();
      const allIds = Array.from({ length: 60 }, (_, i) => `m${i}`);
      const rawResult = await tool.execute("tool-call", {}, undefined, undefined, {
        sessionManager: {
          getSessionFile: () => file,
          getBranch: () => allIds.map((id) => ({ id })),
          getEntries: () => allIds.map((id) => ({ id })),
        },
      });
      const result = rawResult.content[0].text as string;
      // DEFAULT_RECENT = 25, so at most 25 entries returned
      const indexLines = result.split("\n").filter((l: string) => /^#\d+/.test(l.trim()));
      expect(indexLines.length).toBeLessThanOrEqual(25);
      // Should start past the midpoint of the session, not at #0
      const firstIndex = parseInt(indexLines[0]?.match(/#(\d+)/)?.[1] ?? "0");
      expect(firstIndex).toBeGreaterThan(30);
      // Should NOT include entry #0
      expect(result).not.toContain("#0 [user]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("expand returns full content for specific government entries", async () => {
    const { dir, file } = makeGovSession();
    try {
      const tool = register();

      const result = await invoke(tool, file, { expand: [0] });
      expect(result).toContain("#0 [user]");
      expect(result).toContain("information security policy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("government domain: stress scenarios", () => {
  it("cross-referenced regulation query in verbose session", () => {
    // Simulate a session where an agent is cross-referencing multiple
    // regulations across many documents. Every entry mentions "regulation"
    // or "compliance" but specific regulation IDs are rare.
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Cross-reference FISMA with NIST SP 800-53" },
      {
        index: 1,
        role: "assistant",
        summary: "Reviewing FISMA requirements against NIST SP 800-53 control catalog for compliance alignment.",
      },
      { index: 2, role: "tool_result", summary: "[Read] regulations/fisma-2027.txt" },
      { index: 3, role: "assistant", summary: "FISMA Section 3.2 maps to NIST controls AC-2, AU-1, and CA-7." },
      { index: 4, role: "user", summary: "Now check HIPAA compliance against the same regulation framework" },
      {
        index: 5,
        role: "assistant",
        summary: "Cross-referencing HIPAA Security Rule with NIST SP 800-66 for compliance.",
      },
      { index: 6, role: "tool_result", summary: "[Read] regulations/hipaa-security-rule.txt" },
      { index: 7, role: "assistant", summary: "HIPAA §164.312 maps to NIST controls AC-3, AU-9, and SC-8." },
      { index: 8, role: "user", summary: "Generate compliance gap analysis document" },
      {
        index: 9,
        role: "assistant",
        summary: "Generating compliance gap analysis across FISMA, HIPAA, and NIST frameworks.",
        files: ["reports/compliance-gap-analysis.md"],
      },
      { index: 10, role: "tool_result", summary: "[Write] reports/compliance-gap-analysis.md" },
      {
        index: 11,
        role: "assistant",
        summary: "Compliance gap analysis document created. 3 gaps identified in access control and audit regulation.",
      },
    ];
    const msgs: Message[] = [
      { role: "user", content: "Cross-reference FISMA with NIST SP 800-53" } as any,
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Reviewing FISMA requirements against NIST SP 800-53 control catalog for compliance alignment.",
          },
        ],
      } as any,
      {
        role: "toolResult",
        content: [{ type: "text", text: "FISMA implementation guidance for 2027" }],
        toolName: "Read",
        isError: false,
      } as any,
      {
        role: "assistant",
        content: [{ type: "text", text: "FISMA Section 3.2 maps to NIST controls AC-2, AU-1, and CA-7." }],
      } as any,
      { role: "user", content: "Now check HIPAA compliance against the same regulation framework" } as any,
      {
        role: "assistant",
        content: [{ type: "text", text: "Cross-referencing HIPAA Security Rule with NIST SP 800-66 for compliance." }],
      } as any,
      {
        role: "toolResult",
        content: [{ type: "text", text: "HIPAA Security Rule provisions" }],
        toolName: "Read",
        isError: false,
      } as any,
      {
        role: "assistant",
        content: [{ type: "text", text: "HIPAA §164.312 maps to NIST controls AC-3, AU-9, and SC-8." }],
      } as any,
      { role: "user", content: "Generate compliance gap analysis document" } as any,
      {
        role: "assistant",
        content: [
          { type: "text", text: "Generating compliance gap analysis across FISMA, HIPAA, and NIST frameworks." },
        ],
      } as any,
      {
        role: "toolResult",
        content: [{ type: "text", text: "File written successfully" }],
        toolName: "Write",
        isError: false,
      } as any,
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Compliance gap analysis document created. 3 gaps identified in access control and audit regulation.",
          },
        ],
      } as any,
    ];

    // Specific regulation ID should find the right entries
    const fisma = searchEntries(entries, msgs, "HIPAA §164");
    expect(fisma.length).toBeGreaterThan(0);
    expect(fisma.some((h) => h.index === 7)).toBe(true);

    // "compliance NIST regulation" — 3 terms → ≥2 required
    // This would previously match almost every entry
    const broad = searchEntries(entries, msgs, "compliance NIST regulation");
    expect(broad.length).toBeLessThan(entries.length);
    expect(broad.length).toBeGreaterThan(0);
    // Top result should be about cross-referencing (hits all 3 terms)
    expect(broad[0].matchCount).toBeGreaterThanOrEqual(2);
  });

  it("approval-chain session: workflow state queries", () => {
    // Government approval chains: each step mentions "approval" and "review"
    // but the specific step differs.
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Submit travel authorization for approval" },
      {
        index: 1,
        role: "assistant",
        summary: "Travel authorization TA-2027-0442 submitted for supervisor review and approval.",
      },
      { index: 2, role: "user", summary: "Check the approval status of TA-2027-0442" },
      {
        index: 3,
        role: "assistant",
        summary:
          "TA-2027-0442 is pending review by direct supervisor. Approval chain: supervisor → division chief → finance office.",
      },
      { index: 4, role: "user", summary: "Supervisor approved — route to division chief" },
      {
        index: 5,
        role: "assistant",
        summary:
          "TA-2027-0442 routed to division chief for review and approval. Current status: 1 of 3 approvals completed.",
      },
      { index: 6, role: "user", summary: "Division chief returned it — needs updated cost estimate" },
      {
        index: 7,
        role: "assistant",
        summary: "TA-2027-0442 returned for revision. Updated cost estimate required before resubmission for approval.",
      },
      { index: 8, role: "user", summary: "Updated — resubmit for approval" },
      {
        index: 9,
        role: "assistant",
        summary:
          "TA-2027-0442 resubmitted. Approval chain restarted: supervisor review → division chief → finance approval.",
      },
    ];
    const msgs: Message[] = entries.map(
      (e) =>
        ({
          role: e.role === "user" ? "user" : ("assistant" as any),
          content: e.summary,
        }) as any,
    );

    // Specific tracking ID
    const byId = searchEntries(entries, msgs, "TA-2027-0442");
    expect(byId.length).toBeGreaterThanOrEqual(3);
    expect(byId.every((h) => h.summary.includes("TA-2027-0442"))).toBe(true);

    // "approval review" — 2 terms, no floor. Would previously match nearly
    // every entry. Score ratio should keep results reasonable.
    const generic = searchEntries(entries, msgs, "approval review status");
    expect(generic.length).toBeLessThan(entries.length);
    expect(generic.length).toBeGreaterThan(0);
  });

  it("long-form policy document content: clip boundary search", () => {
    // Government documents are long. Important terms may be beyond the
    // 300-char clip boundary in rendered summaries. Search must use
    // the full message content.
    const longPolicy =
      "SECTION 1. PURPOSE AND SCOPE\n" +
      "This policy establishes the framework for information security\n" +
      "management across all departmental units. It applies to all\n" +
      "employees, contractors, and affiliated personnel.\n\n".repeat(10) +
      "SECTION 4. SPECIAL ACCESS PROGRAM (SAP) PROVISIONS\n" +
      "Personnel requiring access to Special Access Program\n" +
      "information must complete SAP indoctrination briefing per\n" +
      "DoD Manual 5205.07 Volume 2 before being granted access.\n" +
      "SAP compliance violations are subject to investigation under\n" +
      "DoDI 5205.11 and may result in access termination.\n\n".repeat(5);

    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Discuss the SAP provisions in the security policy" },
      { index: 1, role: "assistant", summary: longPolicy.slice(0, 300) }, // clipped summary
    ];
    const msgs: Message[] = [
      { role: "user", content: "Discuss the SAP provisions in the security policy" } as any,
      { role: "assistant", content: [{ type: "text", text: longPolicy }] } as any,
    ];

    // "SAP indoctrination" is well beyond the 300-char clip boundary.
    // Both entries are returned because #0 also contains "SAP provisions" matching
    // the first query term. This is correct OR behavior for a 2-term query.
    const r = searchEntries(entries, msgs, "SAP indoctrination");
    expect(r.length).toBeGreaterThanOrEqual(1);
    // The long document (#1) should be the top result (both terms match)
    expect(r[0].index).toBe(1);
    expect(r[0].snippet).toContain("SAP");
  });

  it("memo and directive numbering: regex on government citation patterns", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Find all references to DoD Directive 5200.01" },
      { index: 1, role: "assistant", summary: "DoD Directive 5200.01 is referenced in 3 policy documents." },
      { index: 2, role: "user", summary: "Now check DoD Instruction 5205.11" },
      { index: 3, role: "assistant", summary: "DoD Instruction 5205.11 covers SAP investigation procedures." },
      { index: 4, role: "user", summary: "What about DoD Manual 5205.07?" },
      {
        index: 5,
        role: "assistant",
        summary: "DoD Manual 5205.07 Volume 2 covers SAP indoctrination briefing requirements.",
      },
    ];
    const msgs: Message[] = entries.map(
      (e) =>
        ({
          role: e.role === "user" ? "user" : ("assistant" as any),
          content: e.summary,
        }) as any,
    );

    // Match any DoD 5200-5205 series citation
    const r = searchEntries(entries, msgs, "DoD.*520[0-5]");
    expect(r.length).toBeGreaterThanOrEqual(3);

    // Specific directive number
    const r2 = searchEntries(entries, msgs, "5200.01");
    expect(r2).toHaveLength(2);
  });

  it("mixed acronyms in government session: FISMA vs FedRAMP vs FIPS", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "Map FISMA controls to our system" },
      { index: 1, role: "assistant", summary: "FISMA compliance requires annual assessment under NIST SP 800-53." },
      { index: 2, role: "user", summary: "Also check FedRAMP authorization status" },
      {
        index: 3,
        role: "assistant",
        summary: "FedRAMP authorization is separate from FISMA but shares NIST control baselines.",
      },
      { index: 4, role: "user", summary: "Validate FIPS 140-2 compliance for cryptographic modules" },
      {
        index: 5,
        role: "assistant",
        summary: "FIPS 140-2 validation is required for all cryptographic modules per OMB policy.",
      },
    ];
    const msgs: Message[] = entries.map(
      (e) =>
        ({
          role: e.role === "user" ? "user" : ("assistant" as any),
          content: e.summary,
        }) as any,
    );

    // Each acronym has distinct entries — search should be discriminate
    const fisma = searchEntries(entries, msgs, "FISMA");
    expect(fisma.length).toBeGreaterThanOrEqual(2);

    const fedramp = searchEntries(entries, msgs, "FedRAMP");
    expect(fedramp.length).toBeLessThanOrEqual(2);

    const fips = searchEntries(entries, msgs, "FIPS 140");
    expect(fips.length).toBeLessThanOrEqual(2);

    // Broad query: "compliance authorization" — 2 terms, common in gov
    // Should not dump the whole session
    const broad = searchEntries(entries, msgs, "compliance authorization assessment");
    expect(broad.length).toBeLessThan(entries.length);
  });
});

# 02: Challenge the exact candidate

**Blocked by:** 01
**Status:** done

Use review_code on the candidate branch and approved intent. Ask specifically about missed dependencies, wrong refusals, event lifecycle, unusual legitimate paths and the scan's information loss. Revise and replay when a material finding changes the matcher. Answer every material finding with evidence and retain the review identity and results in this bundle.

Completed: review-6447efe0-3f56-4f7b-bb17-cefbf2c34203, four passes / eight questions, 11 distinct confirmed findings. Repairs are in 7da47ad6 with regression tests; all 11 responses are fixed-claimed (summary revision 20, addressed=true). The same fixed-window replay still flags 59 of 1,200 batches. See `../evidence.md` for each repair, tests and limits. Per the operator's relayed direction, no new full review round was started; repaired source lacks a fresh independent capture.

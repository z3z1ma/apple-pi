# 01: Contribute and recall sourced child learnings

**What to build:** Let write-capable interactive children explicitly read shared learnings and contribute sourced learnings to the primary notebook while they are still working. Direct and nested children use the same primary owner, including when the source child is ephemeral. Provide the model-facing guidance and product contract for these operations, and verify the behavior at the confirmed real-Pi-SDK session/tool seam with scripted models and temporary state. Follow the [governing specification](../spec.md); a later TDD invocation still requires fresh seam confirmation. Keep automatic completion reflection, automatic snapshots, and child-pair participation for their dependent tickets. Preserve primary curation authority, existing tool/trust restrictions, and excluded execution contexts.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A running coding child and a coding grandchild can each add a learning through their registered notebook operation; each accepted addition is visible in the original primary notebook before its contributing invocation finishes, without creating a child-local notebook owner.
- [ ] Two concurrent children can make accepted additions with their own valid evidence, and both additions remain in the primary notebook after either contributing child later fails or is stopped.
- [ ] A child can successfully add a learning, but attempts through child authority to supersede, retire, or perform full notebook maintenance cannot alter existing primary conclusions. Primary curation remains available through its existing authority.
- [ ] A contribution with a fabricated or unauthorized source reference is rejected. For an accepted contribution, retained evidence contains the selected original source entries and their child provenance, rather than a copied whole transcript or unrelated entries.
- [ ] Explicit notebook reads in a coding child return current primary-owned learnings, including updates made after the child started. Primary and child `revisit_note` calls recover the original cited conversation, commands, and results; primary recall still works after an ephemeral source child is disposed.
- [ ] After notebook access has worked in a child, switching or navigating the owning session or shutting it down prevents a late submission from appending a learning or its retained evidence into an unrelated current session or branch.

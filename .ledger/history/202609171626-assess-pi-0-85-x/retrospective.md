Status: complete
Created: 2026-09-17
Updated: 2026-09-17

# Retrospective

## What Mattered

0.85.1 is a host pin, not a product idea. The only Apple Pi surfaces that can break are the ones that subclass or patch Pi: the input card, the footer bridge, and terse-tools. Changelog features (Astra, vLLM, LaTeX, fullscreen jump) are YAGNI.

## Learnings

Custom editors keep the standalone working row unless they opt into `embedWorkingStatus`. The input card already owns its top rule, so the upgrade must not silently embed Pi's spinner.

`pi-mcp-adapter@2.26.0` still loads on 0.85.1 under npm's peer override. Latest 2.34.0 is the honest peer. Temporary pin bumps must restore exact versions, not carets.

## Improvements

For the next Pi upgrade, pack the coding-agent artifact first and diff the patched TUI component `.d.ts` files before installing. Prove terse-tools and the footer bridge on that artifact, then decide whether the MCP adapter pin must move with the host.

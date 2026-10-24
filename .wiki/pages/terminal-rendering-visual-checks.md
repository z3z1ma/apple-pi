# Terminal rendering visual checks

## Synthetic ANSI frames

For an isolated visual check of a transcript renderer, a scratch TypeScript script can render synthetic tool inputs and results to an ANSI frame. Bun executed repository TypeScript with parameter properties in the 2026-10-24 rendering investigation; Node's strip-only loader rejected those properties.

Rich's `Text.from_ansi` and `save_svg` can turn that frame into an SVG. In that investigation, Chrome timed out taking a screenshot of the standalone SVG. Embedding the same SVG in an HTML body with Playwright's `page.set_content`, then taking a viewport screenshot, succeeded. Treat this as a tested fallback, not evidence that standalone SVG screenshots always fail.

A synthetic frame checks appearance, not live session behavior, keyboard routing, or mouse handling. Keep those verification claims separate.

## Sources

- Renderer-parity investigation, 2026-10-24, Pi session `01a16fc0-0f68-7628-af89-f87bb3e3930e`; distilled session learning `07da400b0250`. No private transcript content or generated screen captures are retained here.

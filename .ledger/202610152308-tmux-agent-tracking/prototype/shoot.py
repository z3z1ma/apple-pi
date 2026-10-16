#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["textual==8.2.8", "playwright"]
# ///
"""PROTOTYPE helper: render each sidebar variant headless on live data and save PNG screenshots."""

import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from sidebar import VARIANTS, Sidebar  # noqa: E402

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


async def main(out: Path, width: int, height: int, keys: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    app = Sidebar()
    svgs: list[Path] = []
    async with app.run_test(size=(width, height)) as pilot:
        await pilot.pause(1.5)
        if keys:
            await pilot.press(*keys)
            await pilot.pause(0.3)
        for index, (key, _) in enumerate(VARIANTS):
            await pilot.pause(0.5)
            path = out / f"{index}-{key}.svg"
            app.save_screenshot(filename=path.name, path=str(out))
            svgs.append(path)
            await pilot.press("v")
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=CHROME)
        page = await browser.new_page(device_scale_factor=2)
        for svg in svgs:
            await page.goto(svg.as_uri())
            await page.locator("svg").screenshot(path=str(svg.with_suffix(".png")))
        await browser.close()
    print("\n".join(str(svg.with_suffix(".png")) for svg in svgs))


if __name__ == "__main__":
    asyncio.run(
        main(
            Path(sys.argv[1]),
            int(sys.argv[2]) if len(sys.argv) > 2 else 42,
            int(sys.argv[3]) if len(sys.argv) > 3 else 50,
            sys.argv[4:],
        )
    )

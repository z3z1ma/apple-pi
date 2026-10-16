#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["rich", "playwright"]
# ///
"""PROTOTYPE helper: screenshot a real tmux pane (capture-pane -e) as PNG on a Ghostty-like background."""

import asyncio
import subprocess
import sys
from pathlib import Path

from playwright.async_api import async_playwright
from rich.console import Console
from rich.terminal_theme import TerminalTheme
from rich.text import Text

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
GHOSTTY = TerminalTheme((15, 17, 23), (205, 214, 244), [(0, 0, 0)] * 8, [(128, 128, 128)] * 8)


async def main(target: str, out: Path) -> None:
    ansi = subprocess.run(["tmux", "capture-pane", "-e", "-p", "-t", target], capture_output=True, text=True).stdout
    width = int(
        subprocess.run(["tmux", "display", "-p", "-t", target, "#{pane_width}"], capture_output=True, text=True).stdout
    )
    console = Console(record=True, width=width, file=open("/dev/null", "w"), color_system="truecolor")
    console.print(Text.from_ansi(ansi.rstrip("\n")), soft_wrap=True)
    svg = out.with_suffix(".svg")
    console.save_svg(str(svg), title=target, theme=GHOSTTY)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=CHROME)
        page = await browser.new_page(device_scale_factor=2)
        await page.goto(svg.as_uri())
        await page.locator("svg").screenshot(path=str(out))
        await browser.close()
    print(out)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], Path(sys.argv[2])))

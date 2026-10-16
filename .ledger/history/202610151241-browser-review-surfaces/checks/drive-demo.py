import pathlib, sys, time
from playwright.sync_api import sync_playwright

OUT = pathlib.Path("/tmp/bp")
for _ in range(120):
    if (OUT / "url.txt").exists():
        break
    time.sleep(0.5)
URL = (OUT / "url.txt").read_text().strip()
SHOTS = OUT / "shots"
SHOTS.mkdir(exist_ok=True)
errors = []

def shot(pg, name):
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(SHOTS / f"{name}.png"), animations="disabled")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, color_scheme="light")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto(URL)
    shot(pg, "1-overview")
    pg.evaluate("document.getElementById('stage').scrollTop = 700")
    shot(pg, "2-overview-lower")
    pg.keyboard.press("j")
    shot(pg, "3-ch1")
    pg.keyboard.press("j")
    shot(pg, "4-ch2")
    # comment on the request loop
    first = pg.locator(".hunk.focus .dl .g").nth(3)
    first.click()
    pg.keyboard.type("Name the four stop reasons.")
    pg.keyboard.press("Meta+Enter")
    pg.locator(".dec-c").first.click()
    shot(pg, "5-comment-decision")
    pg.locator(".dec-opt").nth(1).click()
    pg.keyboard.press("Enter")
    pg.keyboard.press("Enter")
    shot(pg, "6-after-enter")
    pg.keyboard.press("l")
    shot(pg, "7-attention")
    pg.keyboard.press("l")
    pg.keyboard.press("Meta+Enter")
    pg.locator(".vd-opt.vd-changes").click()
    pg.fill("#summary", "Close. Split the stop condition.")
    shot(pg, "8-verdict")
    pg.locator(".vd-foot .btn.primary").click()
    shot(pg, "9-sent")
    b.close()
    # saved page, dark
    for _ in range(40):
        if (OUT / "saved.html").exists():
            break
        time.sleep(0.25)
    b = p.chromium.launch(executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, color_scheme="dark")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto((OUT / "saved.html").resolve().as_uri())
    shot(pg, "10-saved-overview-dark")
    pg.keyboard.press("j"); pg.keyboard.press("j")
    shot(pg, "11-saved-ch2-dark")
    b.close()
print("errors:", errors)

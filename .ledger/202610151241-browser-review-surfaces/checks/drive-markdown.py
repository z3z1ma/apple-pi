import json, pathlib, time
from playwright.sync_api import sync_playwright

OUT = pathlib.Path("/tmp/bpm")
for _ in range(120):
    if (OUT / "url.txt").exists():
        break
    time.sleep(0.5)
URL = (OUT / "url.txt").read_text().strip()
SHOTS = OUT / "shots"
SHOTS.mkdir(exist_ok=True)
errors, checks = [], {}
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def shot(pg, name):
    pg.wait_for_timeout(350)
    pg.screenshot(path=str(SHOTS / f"{name}.png"), animations="disabled")


SELECT = """([needle, endNeedle, scrollOnly]) => {
  const find = (text) => {
    const walker = document.createTreeWalker(document.querySelector('.doc'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.data.indexOf(text);
      if (i >= 0) return [n, i];
    }
    throw new Error('not found: ' + text);
  };
  const [a, i] = find(needle);
  if (scrollOnly) { const stage = document.querySelector('.stage'); stage.scrollTop += a.parentElement.getBoundingClientRect().top - innerHeight / 2; return; }
  const range = document.createRange();
  range.setStart(a, i);
  if (endNeedle) { const [b, j] = find(endNeedle); range.setEnd(b, j + endNeedle.length); }
  else range.setEnd(a, i + needle.length);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  a.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}"""


def select(pg, needle, end=None):
    pg.evaluate(SELECT, [needle, end, True])
    pg.wait_for_timeout(200)
    pg.evaluate(SELECT, [needle, end, False])
    pg.wait_for_selector(".tbar")


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    pg = b.new_context(viewport={"width": 1440, "height": 1000}, color_scheme="light").new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("request", lambda r: r.url.endswith("/result") and (OUT / "result-body.json").write_text(r.post_data or ""))
    pg.goto(URL)
    pg.wait_for_selector(".md-app")
    pg.wait_for_selector(".mermaid-box svg", timeout=15000)
    checks["hostile"] = pg.evaluate(
        "({ pwned: window.pwned ?? null, scripts: document.querySelectorAll('.doc script').length,"
        " imgs: document.querySelectorAll('.doc img').length, js: document.querySelectorAll('.doc a[href^=\"javascript\"]').length,"
        " good: document.querySelectorAll('.doc a[href=\"https://example.com\"]').length })"
    )
    shot(pg, "01-overview")

    select(pg, "Never retry 500")
    shot(pg, "02-toolbar")
    pg.keyboard.type("Why not retry 500 once?")
    shot(pg, "03-comment-pop")
    pg.keyboard.press("Meta+Enter")

    select(pg, "Follow `Retry-After`".replace("`", "")[0:6])
    pg.locator(".tbar button[title='Looks good']").click()
    select(pg, "30 seconds in total")
    pg.locator(".tbar button[title='Mark for deletion']").click()
    select(pg, "capped at 8 s")
    pg.locator(".tbar button[title='Suggest a rewrite']").click()
    pg.fill("#pop-text", "capped at 10 s")
    pg.fill("#pop-why", "Match the gateway timeout.")
    shot(pg, "04-suggest-pop")
    pg.keyboard.press("Meta+Enter")
    select(pg, "They need their own design.", "Response ok")
    pg.keyboard.type("C")
    pg.keyboard.type("ross-block comment.")
    pg.keyboard.press("Meta+Enter")
    select(pg, "promises to deduplicate it")
    pg.locator(".tbar button[title='Ask the agent']").click()
    pg.keyboard.type("Why does a key make POST safe?")
    pg.keyboard.press("Meta+Enter")
    pg.wait_for_timeout(1200)
    pg.locator("mark.an.ask").first.click()
    shot(pg, "05-ask-answer")
    pg.keyboard.press("Escape")

    blk = pg.locator(".blk", has_text="Circuit breaking").first
    blk.hover()
    blk.locator(".gut button[title='Rewrite this block']").click()
    pg.fill("#block-src", "Circuit breaking and request hedging are out of scope.\nStreaming bodies are never retried.")
    pg.keyboard.press("Meta+Enter")
    pg.locator(".edit-tag .link", has_text="Show diff").click()
    shot(pg, "06-rewrite-diff")

    checks["outline_before"] = pg.locator(".o-item.on").inner_text()
    for _ in range(6):
        pg.keyboard.press("j")
    pg.wait_for_timeout(500)
    checks["outline_after_6j"] = pg.locator(".o-item.on").inner_text()
    shot(pg, "07-after-j")
    pg.keyboard.press("k")
    pg.wait_for_timeout(500)
    checks["outline_after_k"] = pg.locator(".o-item.on").inner_text()

    pg.locator(".count-pill").click()
    shot(pg, "08-panel")
    pg.locator(".icon-btn[title='Theme']").click()
    pg.wait_for_timeout(800)
    pg.locator(".o-item", has_text="Behaviour").click()
    pg.wait_for_timeout(800)
    shot(pg, "09-dark-mermaid")

    pg.locator(".btn.ghost", has_text="Overall comment").click()
    pg.keyboard.type("Good shape. Settle the 500 question.")
    pg.keyboard.press("Meta+Enter")
    pg.keyboard.press("Meta+Enter")
    pg.locator(".vd-opt.vd-approve_notes").click()
    shot(pg, "10-verdict")
    pg.locator(".vd-foot .btn.primary").click()
    shot(pg, "11-sent")
    b.close()

    for _ in range(40):
        if (OUT / "saved.html").exists():
            break
        time.sleep(0.25)
    b = p.chromium.launch(executable_path=CHROME)
    pg = b.new_context(viewport={"width": 1440, "height": 1000}, color_scheme="dark").new_page()
    pg.on("pageerror", lambda e: errors.append("saved: " + str(e)))
    pg.goto((OUT / "saved.html").as_uri())
    pg.wait_for_selector(".md-app")
    pg.wait_for_timeout(1200)
    checks["saved_marks"] = pg.locator("mark.an").count()
    checks["saved_answer"] = pg.locator(".an-card .dim").first.inner_text()
    shot(pg, "12-saved-dark")
    pg.keyboard.press("?")
    shot(pg, "13-keys")
    b.close()

print(json.dumps({"errors": errors, "checks": checks}, indent=1))

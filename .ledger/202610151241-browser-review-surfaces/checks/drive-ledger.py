import json, pathlib, time
from playwright.sync_api import sync_playwright

OUT = pathlib.Path("/tmp/bpl")
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

SELECT = """([needle, scrollOnly]) => {
  const walker = document.createTreeWalker(document.querySelector('.stage'), NodeFilter.SHOW_TEXT);
  let node, i = -1;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { i = n.data.indexOf(needle); if (i >= 0) { node = n; break; } }
  if (!node) throw new Error('not found: ' + needle);
  if (scrollOnly) { const stage = document.querySelector('.stage'); stage.scrollTop += node.parentElement.getBoundingClientRect().top - innerHeight / 2; return; }
  const range = document.createRange();
  range.setStart(node, i); range.setEnd(node, i + needle.length);
  getSelection().removeAllRanges(); getSelection().addRange(range);
  node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}"""

def select(pg, needle):
    pg.evaluate(SELECT, [needle, True]); pg.wait_for_timeout(200)
    pg.evaluate(SELECT, [needle, False]); pg.wait_for_selector(".tbar")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    pg = b.new_context(viewport={"width": 1440, "height": 1000}, color_scheme="light").new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("request", lambda r: r.url.endswith("/result") and (OUT / "result-body.json").write_text(r.post_data or ""))
    pg.goto(URL); pg.wait_for_selector(".node")
    shot(pg, "01-overview")
    pg.hover(".node:nth-of-type(1)"); shot(pg, "02-hover")
    checks["frontier"] = pg.locator(".gc-foot .chip").all_inner_texts()
    pg.click(".node:has-text('Benchmark runner')"); pg.wait_for_selector(".tk-flow")
    shot(pg, "03-ticket")
    select(pg, "kill rate")
    pg.keyboard.type("Define kill rate here, not only in the spec."); pg.keyboard.press("Meta+Enter")
    select(pg, "fresh copy of the puzzle")
    pg.locator(".tbar button[title='Ask the agent']").click()
    pg.keyboard.type("Why does 03 need both 01 and 02?"); pg.keyboard.press("Meta+Enter")
    pg.wait_for_timeout(1200)
    checks["tree_count_03"] = pg.locator(".t-row.on .t-n").inner_text()
    pg.click(".t-folder:has-text('evaluation')")
    pg.click(".t-row:has-text('traps-balanced.json')"); pg.wait_for_selector(".cvl")
    select(pg, "runsPerArm")
    pg.locator(".tbar button[title='Clarify this']").click()
    shot(pg, "04-evidence")
    pg.keyboard.press("g"); pg.wait_for_selector(".node")
    pg.keyboard.press("]"); pg.wait_for_timeout(300)
    checks["after_]"] = pg.locator(".doc-path span").first.inner_text()
    pg.keyboard.press("]"); pg.wait_for_timeout(300)
    checks["after_]]"] = pg.locator(".doc-path span").first.inner_text()
    pg.click(".count-pill"); shot(pg, "05-panel")
    pg.locator(".pg-file", has_text="traps-balanced").click(); pg.wait_for_timeout(500)
    checks["panel_jump"] = pg.locator(".doc-path span").first.inner_text()
    pg.click(".icon-btn[title='Theme']"); pg.keyboard.press("g"); pg.wait_for_selector(".node"); shot(pg, "06-dark-overview")
    pg.keyboard.press("Meta+Enter"); shot(pg, "07-finish")
    pg.locator(".vd-opt.vd-approve_notes").click()
    pg.locator(".vd-foot .btn.primary").click(); shot(pg, "08-sent")
    b.close()
    for _ in range(40):
        if (OUT / "saved.html").exists():
            break
        time.sleep(0.25)
    b = p.chromium.launch(executable_path=CHROME)
    pg = b.new_context(viewport={"width": 1440, "height": 1000}, color_scheme="dark").new_page()
    pg.on("pageerror", lambda e: errors.append("saved: " + str(e)))
    pg.goto((OUT / "saved.html").as_uri()); pg.wait_for_selector(".node")
    pg.click(".t-folder:has-text('evaluation')"); pg.click(".t-row:has-text('traps-balanced.json')")
    pg.wait_for_selector(".cvl"); pg.wait_for_timeout(500)
    checks["saved_evidence_marks"] = pg.locator("mark.an").count()
    shot(pg, "09-saved-evidence")
    b.close()

print(json.dumps({"errors": errors, "checks": checks}, indent=1))

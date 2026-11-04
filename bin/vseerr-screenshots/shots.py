"""Takes VSeerr's README screenshots from the demo set up by seed.py.

Writes PNG files into the directory given as the first argument. Fails when
an element it needs is missing, so a changed page shows up as a failed run
instead of a wrong picture.
"""

import json
import os
import re
import sys

from playwright.sync_api import Page, sync_playwright

BASE = os.environ.get("VSEERR_URL", "http://127.0.0.1:5055")
STATE_FILE = os.environ.get("DEMO_STATE", "demo-state.json")
OUT = sys.argv[1] if len(sys.argv) > 1 else "screenshots"
PASSWORD = "test1234"
PAD = 12
# Narrower than Tailwind's lg breakpoint (1024 px): a title page is one column,
# so the season list is not squeezed next to the side panel.
TV_VIEWPORT = {"width": 1000, "height": 1400}


def sign_in(page: Page, email: str):
    response = page.request.post(f"{BASE}/api/v1/auth/local", data={"email": email, "password": PASSWORD})
    if response.status != 200:
        sys.exit(f"Sign-in as {email} failed: {response.status}")


def settle(page: Page, ms=800):
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def shoot(page: Page, name: str, boxes, pad=PAD):
    """Screenshot the area around all `boxes` (page coordinates of the viewport)."""
    boxes = [b for b in boxes if b]
    if not boxes:
        sys.exit(f"{name}: nothing to capture")
    left = max(0, min(b["x"] for b in boxes) - pad)
    top = max(0, min(b["y"] for b in boxes) - pad)
    right = max(b["x"] + b["width"] for b in boxes) + pad
    bottom = max(b["y"] + b["height"] for b in boxes) + pad
    path = os.path.join(OUT, f"{name}.png")
    page.screenshot(path=path, clip={"x": left, "y": top, "width": right - left, "height": bottom - top})
    print(f"{name}.png: {round(right - left)}x{round(bottom - top)} CSS px")


def box(locator, name):
    locator.wait_for(state="visible", timeout=30000)
    found = locator.bounding_box()
    if not found:
        sys.exit(f"{name}: not on screen")
    return found


def version_settings(browser):
    """Settings → Services, the German Radarr's version fields."""
    context = browser.new_context(viewport={"width": 1280, "height": 2400}, device_scale_factor=1)
    page = context.new_page()
    sign_in(page, "admin@seerr.dev")
    page.goto(f"{BASE}/settings/services")
    settle(page)
    card = page.locator("li", has=page.get_by_role("heading", name="Radarr German", exact=True))
    card.get_by_role("button", name="Edit").click()
    dialog = page.get_by_role("dialog").last
    dialog.locator("[data-testid=request-options]").wait_for(timeout=30000)
    settle(page, 1500)
    first = dialog.locator("label[for=buttonLabel]").locator("xpath=ancestor::div[contains(@class,'form-row')][1]")
    # Version Name at the top of the dialog's visible part.
    first.evaluate("element => element.scrollIntoView({block: 'start'})")
    page.wait_for_timeout(500)
    add_option = dialog.get_by_role("button", name="Add Option")
    frame = box(dialog, "dialog")
    top, bottom = box(first, "version name"), box(add_option, "add option")
    shoot(page, "admin-version-settings", [
        {"x": frame["x"], "y": top["y"], "width": frame["width"], "height": bottom["y"] + bottom["height"] - top["y"]},
    ], pad=0)
    context.close()


def request_dialog(browser, movie_id):
    """The request dialog as the demo user, German chosen."""
    context = browser.new_context(viewport={"width": 1280, "height": 1100}, device_scale_factor=1)
    page = context.new_page()
    sign_in(page, "demo@seerr.dev")
    page.goto(f"{BASE}/movie/{movie_id}")
    settle(page)
    page.locator("button:enabled", has_text=re.compile(r"^\s*Request\s*$")).first.click()
    dialog = page.get_by_role("dialog").last
    dialog.get_by_role("radio", name=re.compile("^German")).click()
    dialog.get_by_text("Quality Profile").first.wait_for(timeout=30000)
    # Tick the request option: the profile below switches to the one it selects.
    dialog.get_by_text("English is fine until a German dub appears").click()
    dialog.get_by_text("German or English").first.wait_for(timeout=10000)
    settle(page, 1500)
    shoot(page, "request-dialog", [box(dialog, "request dialog")], pad=0)
    context.close()


def versions_panel(browser, movie_id, name):
    """The Versions panel of a movie's page, as the demo user."""
    context = browser.new_context(viewport={"width": 1280, "height": 1400}, device_scale_factor=2)
    page = context.new_page()
    sign_in(page, "demo@seerr.dev")
    page.goto(f"{BASE}/movie/{movie_id}")
    settle(page)
    panel = page.locator("[data-testid=versions-panel]")
    panel.scroll_into_view_if_needed()
    settle(page, 1500)
    shoot(page, name, [box(panel, "versions panel")], pad=0)
    context.close()


def season_rows(browser, show):
    """A show's season rows, with the "?" of the season on air opened."""
    context = browser.new_context(viewport=TV_VIEWPORT, device_scale_factor=1)
    page = context.new_page()
    sign_in(page, "demo@seerr.dev")
    page.goto(f"{BASE}/tv/{show['tmdbId']}")
    settle(page)
    heading = page.get_by_role("heading", name="Seasons", exact=True)
    heading.scroll_into_view_if_needed()
    page.locator("[data-testid=season-version-badges]").first.wait_for(state="attached", timeout=30000)
    settle(page, 1500)
    rows = [page.get_by_role("button", name=re.compile(rf"^Season {number}\b")).first
            for number in range(show["current"], max(0, show["current"] - 3), -1)]
    page.evaluate("window.scrollBy(0, -120)")
    help_icon = rows[0].locator("[data-testid=season-counts-help]")
    if help_icon.count():
        help_icon.click()
        page.locator("[data-testid=season-counts-help-content]").wait_for(timeout=10000)
        page.wait_for_timeout(500)
    row_boxes = [box(row, "season row") for row in rows]
    boxes = [box(heading, "seasons heading")] + row_boxes
    tooltip = page.locator("[data-testid=season-counts-help-content]")
    if tooltip.count():
        boxes.append(box(tooltip.first, "season counts help"))
    left = min(b["x"] for b in row_boxes)
    right = max(b["x"] + b["width"] for b in row_boxes)
    top = min(b["y"] for b in boxes)
    bottom = max(b["y"] + b["height"] for b in boxes)
    shoot(page, "season-rows", [{"x": left, "y": top, "width": right - left, "height": bottom - top}])
    context.close()


def season_episodes(browser, show):
    """The season on air expanded: had, missing and upcoming episodes."""
    # Wide enough (xl) for each episode's still to sit beside its text.
    context = browser.new_context(viewport={"width": 1280, "height": 2400}, device_scale_factor=1)
    page = context.new_page()
    sign_in(page, "demo@seerr.dev")
    page.goto(f"{BASE}/tv/{show['tmdbId']}")
    settle(page)
    page.get_by_role("button", name=re.compile(rf"^Season {show['current']}\b")).first.click()
    page.locator("[data-testid=episode-availability]").first.wait_for(timeout=30000)
    settle(page, 2000)
    aired = show["aired"]
    # Newest first: the next episode to air down to two before the missing one.
    numbers = [n for n in range(aired + 1, max(0, aired - 3), -1) if n <= show["seasons"][str(show["current"])]]
    rows = []
    for number in numbers:
        title = page.locator("h3", has_text=re.compile(rf"^{number} - ")).first
        rows.append(title.locator("xpath=ancestor::div[contains(@class,'py-4')][1]"))
    rows[0].scroll_into_view_if_needed()
    page.wait_for_timeout(800)
    shoot(page, "season-episodes", [box(row, f"episode row {n}") for row, n in zip(rows, numbers)], pad=4)
    context.close()


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(STATE_FILE, encoding="utf-8") as handle:
        state = json.load(handle)
    show = state["show"]
    show["seasons"] = {str(k): v for k, v in show["seasons"].items()}
    movies = state["movies"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        version_settings(browser)
        request_dialog(browser, movies["pulpFiction"])
        versions_panel(browser, movies["matrix"], "versions-panel")
        versions_panel(browser, movies["inception"], "versions-coverage")
        season_rows(browser, show)
        season_episodes(browser, show)
        browser.close()


if __name__ == "__main__":
    main()

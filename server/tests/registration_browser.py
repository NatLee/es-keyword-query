"""Real Chromium registration and administrator review checks.

FIRST_LOGIN_BINARY=/path/to/server python server/tests/registration_browser.py
Uses disposable databases; screenshots contain no entered credentials.
"""
import argparse
from urllib.parse import quote
import json
from playwright.sync_api import sync_playwright, expect
from first_login_browser import server, fill, PASSWORD, ROOT

CHECK_STYLE = """() => {
  const issues = [];
  for (const node of document.querySelectorAll('body *')) {
    if (!node.getClientRects().length) continue;
    const style = getComputedStyle(node);
    for (const key of ['paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','rowGap','columnGap']) {
      const authored = node.computedStyleMap?.().get(key.replace(/[A-Z]/g, m => '-' + m.toLowerCase()))?.toString();
      if (authored === 'auto') continue;
      const n = parseFloat(style[key]);
      if (style[key].endsWith('px') && Math.abs(n / 4 - Math.round(n / 4)) > .01) issues.push(node.tagName + ':' + key + '=' + style[key]);
    }
    if (!['400','600'].includes(style.fontWeight)) issues.push(node.tagName + ':weight=' + style.fontWeight);
  }
  return [...new Set(issues)];
}"""


def register(page, username):
    page.get_by_label("Username", exact=True).fill(username)
    page.get_by_label("Display name", exact=True).fill("Test member")
    page.get_by_label("Password", exact=True).fill(PASSWORD)
    page.get_by_label("Confirm password", exact=True).fill(PASSWORD)
    page.get_by_role("button", name="Create account", exact=True).click()


def check_registration(browser):
    with server() as base:
        admin_context = browser.new_context()
        admin = admin_context.new_page()
        admin.goto(base + "/register")
        expect(admin).to_have_url(base + "/first-login")
        fill(admin)
        admin.get_by_role("button", name="Create administrator", exact=True).click()
        expect(admin).to_have_url(base + "/")
        admin.goto(base + "/connections")
        expect(admin.get_by_role("heading", name="Registration policy", exact=True)).to_be_visible()
        expect(admin.get_by_label("Closed", exact=True)).to_be_checked()
        visitor_context = browser.new_context(viewport={"width": 1440, "height": 1080})
        visitor = visitor_context.new_page()
        visitor.goto(base + "/register")
        expect(visitor.get_by_role("heading", name="Registration is closed", exact=True)).to_be_visible()
        expect(visitor.get_by_role("button", name="Create account", exact=True)).to_have_count(0)

        admin.get_by_label("Administrator approval", exact=True).check()
        admin.get_by_role("button", name="Save registration policy", exact=True).click()
        expect(admin.locator("#page-notice")).to_contain_text("Registration policy saved")
        visitor.goto(base + "/register")
        expect(visitor.get_by_role("heading", name="Create your account", exact=True)).to_be_visible()
        for theme in ["light", "dark"]:
            visitor.emulate_media(color_scheme=theme, reduced_motion="reduce")
            for width in [1440, 390]:
                visitor.set_viewport_size({"width": width, "height": 1080 if width == 1440 else 844})
                assert visitor.evaluate("document.documentElement.scrollWidth <= innerWidth")
                assert not visitor.evaluate(CHECK_STYLE), visitor.evaluate(CHECK_STYLE)
                assert visitor.locator('input[type="password"]').evaluate_all("nodes => nodes.every(n => !n.value)")
                visitor.screenshot(path=str(ROOT / f"docs/images/registration-{theme}-{width}.png"), full_page=True)
        visitor.get_by_label("Username", exact=True).fill("pending-member")
        visitor.get_by_label("Password", exact=True).fill(PASSWORD)
        visitor.get_by_label("Confirm password", exact=True).fill("mismatched-password")
        visitor.get_by_role("button", name="Create account", exact=True).click()
        expect(visitor.get_by_role("alert")).to_contain_text("Passwords do not match")
        register(visitor, "pending-member")
        expect(visitor).to_have_url(base + "/login?registration=pending")
        expect(visitor.get_by_role("status")).to_contain_text("awaiting administrator approval")
        assert visitor.request.get(base + "/api/auth/state").json()["user"] is None
        assert visitor.evaluate("localStorage.length + sessionStorage.length") == 0
        visitor.get_by_label("Username", exact=True).fill("pending-member")
        visitor.get_by_label("Password", exact=True).fill(PASSWORD)
        visitor.get_by_role("button", name="Sign in", exact=True).click()
        expect(visitor.get_by_role("alert")).to_be_visible()

        admin.get_by_role("button", name="Refresh", exact=True).click()
        request = admin.locator(".registration-record").filter(has=admin.get_by_role("heading", name="Test member (pending-member)", exact=True))
        expect(request).to_be_visible()
        for theme in ["light", "dark"]:
            admin.emulate_media(color_scheme=theme, reduced_motion="reduce")
            for width in [1440, 390]:
                admin.set_viewport_size({"width": width, "height": 1080 if width == 1440 else 844})
                assert admin.evaluate("document.documentElement.scrollWidth <= innerWidth")
                assert not admin.evaluate(CHECK_STYLE), admin.evaluate(CHECK_STYLE)
                panel = admin.locator(".section").filter(has=admin.get_by_role("heading", name="Registration policy", exact=True))
                panel.screenshot(path=str(ROOT / f"docs/images/registration-policy-{theme}-{width}.png"))
                if (theme, width) in [("light", 1440), ("dark", 390)]:
                    review = admin.locator(".section").filter(has=admin.get_by_role("heading", name="Registration requests", exact=True))
                    review.screenshot(path=str(ROOT / f"docs/images/registration-review-{theme}-{width}.png"))
        request.get_by_role("button", name="Approve account", exact=True).click()
        expect(admin.locator("#page-notice")).to_contain_text("Account approved")
        visitor.get_by_label("Password", exact=True).fill(PASSWORD)
        visitor.get_by_role("button", name="Sign in", exact=True).click()
        expect(visitor).to_have_url(base + "/")
        visitor.get_by_role("button", name="Sign out", exact=True).click()
        expect(visitor).to_have_url(base + "/login")
        visitor.goto(base + "/register")
        register(visitor, "rejected-member")
        expect(visitor).to_have_url(base + "/login?registration=pending")
        admin.get_by_role("button", name="Refresh", exact=True).click()
        request = admin.locator(".registration-record").filter(has=admin.get_by_role("heading", name="Test member (rejected-member)", exact=True))
        request.get_by_label("Rejection reason", exact=True).fill("Team membership could not be verified.")
        request.get_by_role("button", name="Reject account", exact=True).click()
        expect(admin.locator("#page-notice")).to_contain_text("Account rejected")
        expect(admin.get_by_role("heading", name="Registration history", exact=True)).to_be_visible()
        admin.get_by_label("Open", exact=True).check()
        admin.get_by_role("button", name="Save registration policy", exact=True).click()
        expect(admin.locator("#page-notice")).to_contain_text("Registration policy saved")
        visitor.goto(base + "/register?next=" + quote("/oauth/authorize?client_id=missing", safe=""))
        register(visitor, "open-member")
        expect(visitor).to_have_url(base + "/oauth/authorize?client_id=missing")
        assert visitor.request.get(base + "/api/auth/state").json()["user"]["role"] == "member"
        admin_context.close()
        visitor_context.close()


def provider_intent_and_errors(browser):
    with server() as base:
        context = browser.new_context()
        page = context.new_page()
        page.goto(base)
        fill(page)
        page.get_by_role("button", name="Create administrator", exact=True).click()
        expect(page).to_have_url(base + "/")
        page.get_by_role("button", name="Sign out", exact=True).click()
        page.route("**/api/auth/registration-policy", lambda route: route.fulfill(content_type="application/json", body=json.dumps({"mode": "open", "password_enabled": True, "providers": ["google", "github"], "setup_required": False})))
        page.route("**/api/access/providers", lambda route: route.fulfill(content_type="application/json", body=json.dumps({"items": [{"provider": p, "name": p.title() if p == "google" else "GitHub", "enabled": True, "login_start_url": f"/oauth/login/{p}"} for p in ["google", "github"]]})))
        for code, text in [("account_pending", "awaiting administrator approval"), ("account_rejected", "was rejected"), ("registration_closed", "Registration is closed"), ("setup_required", "first administrator")]:
            page.goto(base + "/login?access_error=" + code)
            expect(page.get_by_role("status")).to_contain_text(text)
        page.goto(base + "/register?next=" + quote("/oauth/authorize?client_id=test", safe=""))
        page.route("**/oauth/login/google?**", lambda route: route.fulfill(content_type="text/html", body="Provider redirect reached"))
        page.get_by_role("button", name="Continue with Google", exact=True).click()
        expect(page).to_have_url(base + "/oauth/login/google?intent=register&next=%2Foauth%2Fauthorize%3Fclient_id%3Dtest")
        context.close()


def boundary_credentials(browser):
    with server() as base:
        admin = browser.new_context()
        page = admin.new_page()
        page.goto(base)
        fill(page)
        page.get_by_role("button", name="Create administrator", exact=True).click()
        expect(page).to_have_url(base + "/")
        response = admin.request.patch(base + "/api/auth/registration-policy", data={"mode": "open"}, headers={"Origin": base})
        assert response.ok
        member = browser.new_context()
        page = member.new_page()
        page.goto(base + "/register")
        username = "boundary-" + "a" * 55
        password = "boundary-password-" + "x" * 238
        assert len(username) == 64 and len(password) == 256
        page.get_by_label("Username", exact=True).fill(username)
        page.get_by_label("Password", exact=True).fill(password)
        page.get_by_label("Confirm password", exact=True).fill(password)
        page.get_by_role("button", name="Create account", exact=True).click()
        expect(page).to_have_url(base + "/")
        page.get_by_role("button", name="Sign out", exact=True).click()
        page.get_by_label("Username", exact=True).fill(username)
        page.get_by_label("Password", exact=True).fill(password)
        expect(page.get_by_label("Username", exact=True)).to_have_value(username)
        expect(page.get_by_label("Password", exact=True)).to_have_value(password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(page).to_have_url(base + "/")
        member.close()
        admin.close()


def mocked_ui_edges(browser):
    """Only management responses are mocked to exercise UI-only failure paths."""
    with server() as base:
        context = browser.new_context()
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base)
        fill(page)
        page.get_by_role("button", name="Create administrator", exact=True).click()
        expect(page).to_have_url(base + "/")
        policy = {"mode": "approval", "password_enabled": True, "providers": ["google"], "setup_required": False}
        page.route("**/api/auth/registration-policy", lambda route: route.fulfill(content_type="application/json", body=json.dumps(policy)))
        stale = False
        requests = []
        def record(number, status="pending"):
            return {"id": number, "user_id": number + 100, "username": f"member-{number}", "display_name": f"Member {number}", "provider": "password", "status": status, "created_at": "2026-11-27T00:00:00Z", "reviewed_at": None, "reviewed_by": None, "rejection_reason": None}
        def registrations(route):
            requests.append(route.request.url)
            if stale:
                data = {"items": [], "next_cursor": None}
            elif "status=active" in route.request.url:
                data = {"items": [record(99, "active")], "next_cursor": None}
            elif "before=51" in route.request.url:
                data = {"items": [record(50)], "next_cursor": None}
            else:
                data = {"items": [record(52), record(51)], "next_cursor": 51}
            route.fulfill(content_type="application/json", body=json.dumps(data))
        page.route("**/api/auth/registrations?**", registrations)
        def history(route):
            older = "before=2" in route.request.url
            data = {"items": [{"id": 1 if older else 2, "actor_id": 1, "actor_username": "browser-admin", "action": "approved" if older else "policy_changed", "registration_id": 1 if older else None, "mode": None if older else "approval", "reason": None, "created_at": "2026-11-27T00:00:00Z"}], "next_cursor": None if older else 2}
            route.fulfill(content_type="application/json", body=json.dumps(data))
        page.route("**/api/auth/registration-events?**", history)
        def stale_review(route):
            nonlocal stale
            stale = True
            route.fulfill(status=409, content_type="application/json", body=json.dumps({"error": "Already reviewed"}))
        page.route("**/api/auth/registrations/52/review", stale_review)
        page.goto(base + "/connections")
        expect(page.get_by_role("heading", name="Member 52 (member-52)", exact=True)).to_be_visible()
        for theme in ["light", "dark"]:
            page.emulate_media(color_scheme=theme, reduced_motion="reduce")
            for width in [1440, 390]:
                page.set_viewport_size({"width": width, "height": 1080 if width == 1440 else 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                assert not page.evaluate(CHECK_STYLE), page.evaluate(CHECK_STYLE)
        page.get_by_role("button", name="Load earlier requests", exact=True).click()
        expect(page.get_by_role("heading", name="Member 50 (member-50)", exact=True)).to_be_visible()
        assert "before=51" in requests[-1]
        page.get_by_role("button", name="Load earlier registration history", exact=True).click()
        expect(page.locator(".registration-event")).to_have_count(2)
        page.get_by_label("Request status", exact=True).select_option("active")
        expect(page.get_by_role("heading", name="Member 99 (member-99)", exact=True)).to_be_visible()
        expect(page.get_by_role("heading", name="Member 50 (member-50)", exact=True)).to_have_count(0)
        page.get_by_label("Request status", exact=True).select_option("pending")
        row = page.get_by_role("article").filter(has=page.get_by_role("heading", name="Member 52 (member-52)", exact=True))
        row.get_by_role("button", name="Reject account", exact=True).click()
        expect(row.get_by_label("Rejection reason", exact=True)).to_be_focused()
        row.get_by_role("button", name="Approve account", exact=True).click()
        expect(page.locator("#page-notice")).to_contain_text("already reviewed")
        expect(page.get_by_text("No accounts are waiting for review.", exact=True)).to_be_visible()
        page.route("**/api/access/providers", lambda route: route.fulfill(content_type="application/json", body=json.dumps({"items": [{"provider": "google", "name": "Google", "enabled": True, "login_start_url": "/oauth/login/google"}]})))
        page.route("**/api/access/overview", lambda route: route.fulfill(content_type="application/json", body=json.dumps({"identities": [{"id": "final-google", "provider": "google", "subject_mask": "…1234", "linked_at": "2026-11-27T00:00:00Z"}], "credentials": [], "grants": []})))
        page.route("**/api/access/identities/final-google", lambda route: route.fulfill(status=400, content_type="application/json", body=json.dumps({"error": "Add another sign-in method before unlinking your last identity.", "code": "last_login_method"})))
        page.get_by_role("button", name="Refresh", exact=True).click()
        page.get_by_role("button", name="Unlink Google", exact=True).click()
        expect(page.get_by_role("alert")).to_contain_text("Add another sign-in method")
        expect(page.get_by_role("button", name="Unlink Google", exact=True)).to_be_enabled()
        assert not errors, errors
        context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mocked-ui-only", action="store_true")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        if not args.mocked_ui_only:
            check_registration(browser)
            provider_intent_and_errors(browser)
            boundary_credentials(browser)
        mocked_ui_edges(browser)
        browser.close()
    print("Actual browser registration checks passed")

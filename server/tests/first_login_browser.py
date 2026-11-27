"""Actual Chromium regression checks; requires playwright and Google Chrome.

FIRST_LOGIN_BINARY=/path/to/server python server/tests/first_login_browser.py
Use --entry-only to demonstrate the missing dedicated route before implementation.
"""
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen
import argparse
import json
import os
import socket
import secrets
import subprocess
import time
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
BINARY = os.environ.get("FIRST_LOGIN_BINARY", "/tmp/first-login-es-target/debug/es-keyword-query-server")
PASSWORD = "browser-test-password-123"

@contextmanager
def server():
    with TemporaryDirectory(prefix="first-login-es-") as directory:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        env = {**os.environ, "ES_SERVER_BIND": f"127.0.0.1:{port}",
               "ES_SERVER_DATA_DIR": directory, "ACCESS_PUBLIC_URL": base,
               "ES_SERVER_STATIC_DIR": str(ROOT / "server/web"),
               "ACCESS_SETUP_TOKEN": "", "ACCESS_GITHUB_CLIENT_ID": "",
               "ACCESS_GITHUB_CLIENT_SECRET": "", "ACCESS_GOOGLE_CLIENT_ID": "",
               "ACCESS_GOOGLE_CLIENT_SECRET": ""}
        env.pop("ACCESS_SETUP_TOKEN", None)
        process = subprocess.Popen([BINARY], cwd=ROOT, env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    with urlopen(base + "/api/auth/state", timeout=1): break
                except OSError: time.sleep(.1)
            else: raise RuntimeError("Disposable server did not start")
            yield base
        finally:
            process.terminate()
            process.wait(timeout=10)

def fill(page, confirmation=PASSWORD):
    page.get_by_label("Username", exact=True).fill("browser-admin")
    page.get_by_label("Display name", exact=True).fill("Browser administrator")
    page.get_by_label("Password", exact=True).fill(PASSWORD)
    page.get_by_label("Confirm password", exact=True).fill(confirmation)

def empty_entry(browser, entry_only):
    with server() as base:
        context = browser.new_context(viewport={"width":1440,"height":1080})
        page = context.new_page()
        page.goto(base + "/connections?next=https%3A%2F%2Fevil.example")
        expect(page).to_have_url(base + "/first-login")
        expect(page.get_by_role("heading", name="Create your first administrator")).to_be_visible()
        if entry_only:
            context.close()
            return
        # Fresh captures: no values ever entered into any account or secret input.
        for theme in ["light", "dark"]:
            page.emulate_media(color_scheme=theme, reduced_motion="reduce")
            for width in [1440,390]:
                page.set_viewport_size({"width":width,"height":1080 if width == 1440 else 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                assert page.locator('input[type="password"]').evaluate_all("nodes => nodes.every(n => !n.value)")
                page.screenshot(path=str(ROOT / f"docs/images/first-login-{theme}-{width}.png"), full_page=True)
        page.set_viewport_size({"width":1440,"height":1080})
        posts=[]
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/api/auth/setup") else None)
        fill(page, "different-password")
        page.get_by_role("button",name="Create administrator",exact=True).click()
        expect(page.get_by_role("alert")).to_contain_text("Passwords do not match")
        assert posts == [], "Mismatch must never send setup"
        page.get_by_label("Confirm password",exact=True).fill(PASSWORD)
        # Repeated events while the real request is pending must create one request.
        page.locator("form").evaluate("form => {form.requestSubmit(); form.dispatchEvent(new Event('submit', {cancelable:true}));}")
        expect(page.get_by_role("button",name="Sign out",exact=True)).to_be_visible()
        expect(page).to_have_url(base + "/")
        assert len(posts) == 1
        assert page.evaluate("localStorage.length + sessionStorage.length") == 0
        page.goto(base + "/first-login")
        expect(page).to_have_url(base + "/")
        page.get_by_role("button",name="Sign out",exact=True).click()
        expect(page).to_have_url(base + "/login")
        page.goto(base + "/first-login?next=https%3A%2F%2Fevil.example")
        expect(page).to_have_url(base + "/login")
        expect(page.get_by_label("Confirm password",exact=True)).to_have_count(0)
        page.get_by_label("Username",exact=True).fill("browser-admin")
        page.get_by_label("Password",exact=True).fill(PASSWORD)
        page.get_by_role("button",name="Sign in",exact=True).click()
        expect(page.get_by_role("button",name="Sign out",exact=True)).to_be_visible()
        context.close()

def conflict(browser):
    with server() as base:
        one=browser.new_context(); two=browser.new_context()
        first=one.new_page(); stale=two.new_page()
        first.goto(base); stale.goto(base)
        expect(stale).to_have_url(base + "/first-login")
        fill(first); first.get_by_role("button",name="Create administrator",exact=True).click()
        expect(first.get_by_role("button",name="Sign out",exact=True)).to_be_visible()
        fill(stale); stale.get_by_role("button",name="Create administrator",exact=True).click()
        expect(stale).to_have_url(base + "/login")
        expect(stale.get_by_label("Confirm password",exact=True)).to_have_count(0)
        one.close(); two.close()

def conflict_with_state_failure(browser):
    # Another browser's successful initialization is authoritative even when
    # the state endpoint becomes unavailable immediately after setup returns409.
    with server() as base:
        one=browser.new_context(); two=browser.new_context()
        first=one.new_page(); stale=two.new_page(); errors=[]
        stale.on("pageerror",lambda error: errors.append(str(error)))
        first.goto(base); stale.goto(base + "/first-login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dmissing")
        expect(stale.get_by_role("button",name="Create administrator",exact=True)).to_be_visible()
        fill(first); first.get_by_role("button",name="Create administrator",exact=True).click()
        expect(first.get_by_role("button",name="Sign out",exact=True)).to_be_visible()
        stale.route("**/api/auth/state",lambda route: route.fulfill(status=503,content_type="application/json",body=json.dumps({"error":"State temporarily unavailable"})))
        fill(stale); stale.get_by_role("button",name="Create administrator",exact=True).click()
        expect(stale).to_have_url(base + "/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dmissing")
        expect(stale.get_by_role("button",name="Create administrator",exact=True)).to_have_count(0)
        assert errors == [], "Closed setup must never emit an unhandled state-refresh rejection"
        one.close(); two.close()

def continuation(browser):
    for next_url, accepted in [("/oauth/authorize?client_id=missing&state=test",True),
                                ("//evil.example/path",False),
                                ("/oauth/authorize?x=1#fragment",False),
                                ("/oauth/authorize?x=\\evil",False)]:
        with server() as base:
            context=browser.new_context(); page=context.new_page()
            from urllib.parse import quote
            page.goto(base + "/login?next=" + quote(next_url,safe=""))
            expected=base + "/first-login" + ("?next=" + quote(next_url,safe="~()*!.'-") if accepted else "")
            expect(page).to_have_url(expected)
            fill(page)
            requests=[]
            page.on("request",lambda r: requests.append(r.url) if "/oauth/authorize?" in r.url else None)
            page.get_by_role("button",name="Create administrator",exact=True).click()
            if accepted:
                expect(page).to_have_url(base + next_url)
                assert len(requests) == 1
            else:
                expect(page.get_by_role("button",name="Sign out",exact=True)).to_be_visible()
                expect(page).to_have_url(base + "/")
                assert not requests
            context.close()

def provider_error(browser):
    with server() as base:
        context=browser.new_context(); page=context.new_page(); page.goto(base)
        fill(page); page.get_by_role("button",name="Create administrator",exact=True).click()
        expect(page.get_by_role("button",name="Sign out",exact=True)).to_be_visible()
        page.get_by_role("button",name="Sign out",exact=True).click()
        expect(page).to_have_url(base + "/login")
        page.goto(base + "/login?access_error=identity_not_linked")
        expect(page.get_by_role("status")).to_contain_text("This identity is not linked")
        expect(page).to_have_url(base + "/login?access_error=identity_not_linked")
        page.goto(base + "/login?access_error=unrecognized-value")
        expect(page).to_have_url(base + "/login")
        expect(page.locator("#page-notice")).to_have_count(0)
        context.close()

def server_failure(browser):
    with server() as base:
        context=browser.new_context(); page=context.new_page(); page.goto(base)
        fill(page)
        page.route("**/api/auth/setup",lambda route: route.fulfill(status=503,content_type="application/json",body=json.dumps({"error":"Temporary setup failure"})))
        page.get_by_role("button",name="Create administrator",exact=True).click()
        expect(page.get_by_role("alert")).to_have_text("Temporary setup failure")
        expect(page.get_by_role("button",name="Create administrator",exact=True)).to_be_enabled()
        expect(page.get_by_label("Password",exact=True)).to_have_value("")
        expect(page.get_by_label("Confirm password",exact=True)).to_have_value("")
        context.close()

@contextmanager
def docker_server(token):
    with TemporaryDirectory(prefix="first-login-es-docker-") as directory:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1",0)); port=listener.getsockname()[1]
        base=f"http://127.0.0.1:{port}"
        environment=Path(directory) / "deployment.env"
        environment.write_text("ACCESS_PUBLIC_URL=" + base + "\n" + ("ACCESS_SETUP_TOKEN=" + token + "\n" if token else ""))
        environment.chmod(0o600)
        name="first-login-es-" + secrets.token_hex(4)
        subprocess.run(["docker","run","--detach","--rm","--name",name,"--publish",f"127.0.0.1:{port}:8670","--env-file",str(environment),"es-keyword-query-first-login:local"],check=True,stdout=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    with urlopen(base + "/api/auth/state",timeout=1): break
                except OSError: time.sleep(.1)
            else: raise RuntimeError("Disposable Docker server did not start")
            yield base
        finally:
            subprocess.run(["docker","stop",name],check=True,stdout=subprocess.DEVNULL)

def docker_checks(browser):
    for token in [None,secrets.token_urlsafe(32)]:
        with docker_server(token) as base:
            context=browser.new_context(viewport={"width":1440,"height":1080}); page=context.new_page()
            page.goto(base)
            expect(page).to_have_url(base + "/first-login")
            state=page.request.get(base + "/api/auth/state").json()
            assert state["setup_token_required"] is True, "Docker must exercise a real nonloopback peer"
            assert state["setup_token_configured"] is bool(token)
            for candidate in [None,"incorrect-deployment-code"]:
                response=page.request.post(base + "/api/auth/setup",data={"username":"denied-admin","password":PASSWORD,"setup_token":candidate})
                assert response.status == 403
            if token:
                expect(page.get_by_label("Deployment setup code",exact=True)).to_be_visible()
                assert page.locator('input[type="password"]').evaluate_all("nodes => nodes.every(n => !n.value)")
                page.screenshot(path=str(ROOT / "docs/images/first-login-docker-token.png"),full_page=True)
                fill(page)
                page.get_by_label("Deployment setup code",exact=True).fill(token)
                page.get_by_role("button",name="Create administrator",exact=True).click()
                expect(page.get_by_role("button",name="Sign out",exact=True)).to_be_visible()
                assert page.evaluate("localStorage.length + sessionStorage.length") == 0
                state=page.request.get(base + "/api/auth/state").json()
                assert state["setup_required"] is False and state["setup_token_configured"] is False
                response=page.request.post(base + "/api/auth/setup",data={"username":"late-admin","password":PASSWORD,"setup_token":token})
                assert response.status == 409
                page.get_by_role("button",name="Sign out",exact=True).click()
                expect(page).to_have_url(base + "/login")
            else:
                expect(page.get_by_role("button",name="Create administrator",exact=True)).to_be_disabled()
                expect(page.get_by_role("status")).to_contain_text("Remote setup is locked")
            context.close()

if __name__ == "__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("--entry-only",action="store_true"); parser.add_argument("--docker",action="store_true"); args=parser.parse_args()
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(channel="chrome")
        if args.docker:
            docker_checks(browser)
        else:
            empty_entry(browser,args.entry_only)
            if not args.entry_only:
                conflict(browser); conflict_with_state_failure(browser); continuation(browser); provider_error(browser); server_failure(browser)
        browser.close()
    print("Actual browser first-login checks passed" + (" (rebuilt Docker image, nonloopback peers)" if args.docker else ""))

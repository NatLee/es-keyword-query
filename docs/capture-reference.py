"""Capture the offline reference and assert responsive controls with Playwright."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH'))
    page = browser.new_page(viewport={'width': 1440, 'height': 1140})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto((root / 'docs/index.html').as_uri())
    page.screenshot(path=str(root / 'docs/images/reference-desktop.png'), full_page=True)
    for label, expected in [('Proximity', '("apple pie"~5) AND "bakery"'), ('Unicode', '("茶" OR "咖啡") AND "店"')]:
        page.get_by_role('button', name=label, exact=True).click()
        expect(page.locator('#output')).to_have_text(expected)
    page.get_by_role('button', name='Switch color theme').click()
    expect(page.locator('html')).to_have_class('light')
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(root / 'docs/images/reference-mobile.png'), full_page=True)
    assert not errors, errors
    print(json.dumps({'desktop': '1440 x 1140', 'mobile': '390 x 844', 'examples': 'Boolean, Proximity, Unicode', 'theme_toggle': 'passed', 'horizontal_overflow': False, 'page_errors': errors}, indent=2))
    browser.close()

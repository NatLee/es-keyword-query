"""Verify the finite Rust-generated atlas and capture its real UI.

pip install playwright && playwright install chromium
Optional: PLAYWRIGHT_CHANNEL=chrome
"""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel=os.environ.get('PLAYWRIGHT_CHANNEL'), executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH'))
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto((root / 'docs/index.html').as_uri())
    data = page.evaluate('window.ATLAS')
    for i, item in enumerate(data):
        page.locator('#specimens button').nth(i).click()
        for mode in [0, 1]:
            page.locator('#mode').select_option(str(mode))
            value = item['modes'][mode]
            if value['valid']:
                expect(page.locator('#compiled')).to_have_text(value['query_string'])
                expect(page.locator('.node')).to_have_count(len(value['clauses']))
                page.locator('#filter').select_option('0')
                expect(page.locator('#compiled')).to_have_text(value['filtered'][0])
                page.locator('#filter').select_option('')
            else:
                expect(page.locator('#copy')).to_be_disabled()
                expect(page.locator('.error-pane')).to_contain_text(value['error']['message'])
    page.locator('#specimens button').nth(3).click()
    page.locator('#mode').select_option('0')
    page.locator('.node').last.click()
    expect(page.locator('.clause-label')).to_have_text('toy')
    page.get_by_role('tab', name='01 Normalize').click()
    expect(page.locator('#stage-panel')).to_contain_text(data[3]['modes'][0]['normalized'])
    page.get_by_role('tab', name='03 Compile').click()
    expect(page.locator('#stage-panel pre')).to_have_text(data[3]['modes'][0]['query_string'])
    page.get_by_role('tab', name='02 Structure').click()
    page.locator('.node').nth(6).click()
    with page.expect_download() as download:
        page.locator('#download').click()
    payload = json.loads(Path(download.value.path()).read_text())
    assert payload['query_string'] == data[3]['modes'][0]['query_string']
    for width in [320, 390, 768, 1024, 1440]:
        page.set_viewport_size({'width': width, 'height': 1100})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
    page.screenshot(path=str(root / 'docs/images/reference-desktop.png'), full_page=True)
    page.locator('#theme').click()
    expect(page.locator('html')).to_have_class('light')
    page.screenshot(path=str(root / 'docs/images/reference-light.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(root / 'docs/images/reference-mobile.png'), full_page=True)
    assert not errors, errors
    print(json.dumps({'specimens': 8, 'modes': 2, 'filter_outputs': 14, 'stages': 'passed', 'node_selection': 'passed', 'export': 'passed', 'widths': [320, 390, 768, 1024, 1440], 'page_errors': errors}, indent=2))
    browser.close()

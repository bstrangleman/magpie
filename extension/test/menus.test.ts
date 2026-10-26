import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { bookmarkFromMenu, isWebUrl } from '../src/menus.ts';

describe('extension context menus', () => {
  const tab = { url: 'https://example.com/post', title: 'A [great] post' };

  test('page, link and image', () => {
    assert.deepEqual(bookmarkFromMenu('save-page', {}, tab), { url: tab.url, title: tab.title });
    assert.deepEqual(bookmarkFromMenu('save-link', { linkUrl: 'https://other.example/x' }, tab), { url: 'https://other.example/x' });
    assert.deepEqual(bookmarkFromMenu('save-image', { srcUrl: 'https://cdn.example/a.png' }, tab), { url: 'https://cdn.example/a.png' });
  });

  test('selection becomes a quoted note linking back to the page', () => {
    const b = bookmarkFromMenu('save-selection', { selectionText: ' line one\nline two ' }, tab);
    assert.deepEqual(b, {
      title: 'A [great] post',
      note: '> line one\n> line two\n\n— [A \\[great\\] post](https://example.com/post)',
    });
  });

  test('ignores pages that are not on the web', () => {
    assert.equal(bookmarkFromMenu('save-page', {}, { url: 'chrome://extensions', title: 'Extensions' }), null);
    assert.equal(bookmarkFromMenu('save-image', { srcUrl: 'data:image/png;base64,AAAA' }, tab), null);
    assert.equal(bookmarkFromMenu('save-selection', { selectionText: '   ' }, tab), null);
    assert.equal(bookmarkFromMenu('unknown', {}, tab), null);
    assert.equal(isWebUrl('about:blank'), false);
    assert.equal(isWebUrl('HTTPS://EXAMPLE.COM'), true);
  });

  test('falls back to the click page URL when the tab has none', () => {
    assert.deepEqual(bookmarkFromMenu('save-page', { pageUrl: 'https://example.org/' }, {}), { url: 'https://example.org/', title: undefined });
  });
});

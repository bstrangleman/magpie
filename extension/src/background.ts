// Background script: context menus, plus the toolbar badge shown after saving.
import { client, getConnection } from './api.ts';
import { ext } from './browser.ts';
import { bookmarkFromMenu, MENUS } from './menus.ts';

export type BadgeMessage = { type: 'badge'; tabId: number; state: 'saved' | 'error' | 'clear' };

async function setupMenus() {
  await ext.contextMenus.removeAll();
  for (const m of MENUS) ext.contextMenus.create({ id: m.id, title: m.title, contexts: m.contexts });
}

/** Show ✓ or ! on the toolbar button for a few seconds. */
async function badge(tabId: number | undefined, state: BadgeMessage['state']) {
  if (tabId === undefined || tabId < 0) return;
  try {
    await ext.action.setBadgeText({ tabId, text: state === 'saved' ? '✓' : state === 'error' ? '!' : '' });
    if (state !== 'clear') {
      await ext.action.setBadgeBackgroundColor({ tabId, color: state === 'saved' ? '#30a46c' : '#e5484d' });
      setTimeout(() => ext.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 4000);
    }
  } catch {
    // The tab may have closed.
  }
}

// Listeners are registered synchronously at the top level so they survive service-worker restarts.
ext.runtime.onInstalled.addListener((details) => {
  setupMenus();
  if (details.reason === 'install') ext.runtime.openOptionsPage();
});
ext.runtime.onStartup.addListener(setupMenus);

ext.runtime.onMessage.addListener((message: BadgeMessage) => {
  if (message?.type === 'badge') badge(message.tabId, message.state);
});

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  const body = bookmarkFromMenu(String(info.menuItemId), info, tab);
  if (!body) return;
  const conn = await getConnection();
  if (!conn) {
    ext.runtime.openOptionsPage();
    return;
  }
  try {
    await client(conn).post('/bookmarks', body);
    badge(tab?.id, 'saved');
  } catch (err) {
    console.error('[magpie] save failed', err);
    badge(tab?.id, 'error');
  }
});

// Context menu definitions and how each one turns into a new bookmark.
// Kept free of browser APIs so it can be unit tested with node:test.

export type MenuId = 'save-page' | 'save-link' | 'save-image' | 'save-selection';
type MenuContext = 'page' | 'link' | 'image' | 'selection';

export const MENUS: { id: MenuId; title: string; contexts: [MenuContext, ...MenuContext[]] }[] = [
  { id: 'save-page', title: 'Save page to Magpie', contexts: ['page'] },
  { id: 'save-link', title: 'Save link to Magpie', contexts: ['link'] },
  { id: 'save-image', title: 'Save image to Magpie', contexts: ['image'] },
  { id: 'save-selection', title: 'Save selection to Magpie as a note', contexts: ['selection'] },
];

export interface MenuClick {
  linkUrl?: string;
  srcUrl?: string;
  pageUrl?: string;
  selectionText?: string;
}

export interface PageInfo {
  url?: string;
  title?: string;
}

export interface NewBookmark {
  url?: string;
  title?: string;
  note?: string;
}

/** Only ordinary web pages can be saved (not chrome://, about:, file:, data: …). */
export const isWebUrl = (url: string | undefined): url is string => !!url && /^https?:\/\//i.test(url);

const escapeLinkText = (s: string) => s.replace(/[[\]]/g, '\\$&');

export function bookmarkFromMenu(id: string, click: MenuClick, tab?: PageInfo): NewBookmark | null {
  const pageUrl = isWebUrl(tab?.url) ? tab.url : isWebUrl(click.pageUrl) ? click.pageUrl : undefined;
  switch (id) {
    case 'save-page':
      return pageUrl ? { url: pageUrl, title: tab?.title || undefined } : null;
    case 'save-link':
      return isWebUrl(click.linkUrl) ? { url: click.linkUrl } : null;
    case 'save-image':
      return isWebUrl(click.srcUrl) ? { url: click.srcUrl } : null;
    case 'save-selection': {
      const text = click.selectionText?.trim();
      if (!text) return null;
      const quote = text
        .split(/\r?\n/)
        .map((line) => `> ${line}`.trimEnd())
        .join('\n');
      const source = pageUrl ? `\n\n— [${escapeLinkText(tab?.title || pageUrl)}](${pageUrl})` : '';
      return { title: tab?.title || undefined, note: quote + source };
    }
  }
  return null;
}

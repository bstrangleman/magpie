// Reading a page's metadata and readable text from its HTML. Pure functions with no database or
// network access, so they can run in a worker thread (see extract-pool.ts) as well as in tests.
import { isProbablyReaderable, Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import sanitizeHtml from 'sanitize-html';
import type { BookmarkType } from '../../shared/types.ts';
import { absoluteUrl } from '../lib/url.ts';

type ReadabilityDoc = Parameters<typeof isProbablyReaderable>[0];

export interface Metadata {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  type: BookmarkType;
  contentHtml: string | null;
  contentText: string | null;
}

const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com|tiktok\.com|loom\.com)$/;
const AUDIO_HOSTS = /(^|\.)(soundcloud\.com|open\.spotify\.com|bandcamp\.com|podcasts\.apple\.com|music\.apple\.com|mixcloud\.com)$/;

export const clean = (s: string | null | undefined, max = 1000) => {
  const v = s?.replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : null;
};

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags.filter((t) => t !== 'html' && t !== 'body'),
    'img',
    'figure',
    'figcaption',
    'picture',
    'del',
    'ins',
    'sup',
    'sub',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    '*': ['lang', 'dir'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
};

function sanitizeContent(html: string, baseUrl: string): string {
  return sanitizeHtml(html, {
    ...SANITIZE,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, href: absoluteUrl(attribs.href, baseUrl) ?? '', target: '_blank', rel: 'noopener noreferrer' },
      }),
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, src: absoluteUrl(attribs.src ?? attribs['data-src'], baseUrl) ?? '' },
      }),
    },
    allowedAttributes: { ...SANITIZE.allowedAttributes, a: ['href', 'title', 'target', 'rel'] },
  });
}

export function extractMetadata(html: string, pageUrl: string): Metadata {
  const { document } = parseHTML(html);
  const meta = (...keys: string[]) => {
    for (const key of keys) {
      const el = document.querySelector(`meta[property="${key}"]`) ?? document.querySelector(`meta[name="${key}"]`);
      const value = el?.getAttribute('content')?.trim();
      if (value) return value;
    }
    return null;
  };

  const title = clean(meta('og:title', 'twitter:title') ?? document.querySelector('title')?.textContent ?? document.querySelector('h1')?.textContent);
  const description = clean(meta('og:description', 'twitter:description', 'description'), 2000);
  const image = absoluteUrl(
    meta('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src') ??
      document.querySelector('link[rel="image_src"]')?.getAttribute('href'),
    pageUrl,
  );

  let favicon: string | null = null;
  let touchIcon: string | null = null;
  for (const link of document.querySelectorAll('link[rel][href]')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    const href = absoluteUrl(link.getAttribute('href'), pageUrl);
    if (!href) continue;
    if (!favicon && rel.includes('icon')) favicon = href;
    if (!touchIcon && rel.includes('apple-touch-icon')) touchIcon = href;
  }
  favicon ??= touchIcon ?? new URL('/favicon.ico', pageUrl).href;

  // Reader view: Readability mutates the DOM, so give it a fresh copy.
  let contentHtml: string | null = null;
  let contentText: string | null = null;
  let readerable = false;
  try {
    const { document: doc } = parseHTML(html);
    readerable = isProbablyReaderable(doc as unknown as ReadabilityDoc);
    const article = new Readability(doc as unknown as ReadabilityDoc, { charThreshold: 300 }).parse();
    if (article?.content && article.textContent && article.textContent.trim().length > 200) {
      contentHtml = sanitizeContent(article.content, pageUrl).slice(0, 2_000_000);
      contentText = article.textContent.replace(/\s+/g, ' ').trim().slice(0, 200_000);
    }
  } catch {
    // Unparseable pages just don't get a reader view.
  }

  const ogType = (meta('og:type') ?? '').toLowerCase();
  const host = new URL(pageUrl).hostname;
  let type: BookmarkType = 'link';
  if (ogType.startsWith('video') || VIDEO_HOSTS.test(host)) type = 'video';
  else if (ogType.startsWith('music') || AUDIO_HOSTS.test(host)) type = 'audio';
  else if (ogType === 'article' || (readerable && (contentText?.length ?? 0) > 1500) || (contentText?.length ?? 0) > 4000) type = 'article';

  return { title, description, image, favicon, type, contentHtml, contentText };
}

export function typeFromMime(mime: string): BookmarkType | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || mime.includes('document') || mime.includes('msword') || mime.includes('presentation')) {
    return 'document';
  }
  return null;
}

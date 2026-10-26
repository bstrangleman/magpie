import DOMPurify from 'dompurify';
import { ExternalLink, Pencil, X } from 'lucide-react';
import { marked } from 'marked';
import { useMemo } from 'react';
import type { Bookmark } from '../../../shared/types.ts';
import { useBookmark, useContent } from '../lib/queries.ts';
import { longDate, youtubeId } from '../lib/utils.ts';
import { PanelShell } from './BookmarkPanel.tsx';
import { Favicon } from './common.tsx';
import { buttonClass, IconButton, Spinner } from './ui.tsx';
import { useUI } from './ui-context.tsx';

// Links in rendered content always open in a new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const markdown = (text: string) => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }) as string);

export function Reader({ id }: { id: number }) {
  const { setPanel } = useUI();
  const { data: b, isLoading } = useBookmark(id);

  return (
    <PanelShell wide>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
        {b && <Favicon src={b.favicon} size={16} />}
        <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{b?.site ?? (b?.type === 'note' ? 'Note' : b?.file?.name)}</span>
        {b && (b.url || b.file) && (
          <a href={b.url ?? b.file!.url} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'sm')}>
            <ExternalLink size={15} strokeWidth={1.9} /> Open
          </a>
        )}
        <IconButton icon={Pencil} label="Edit" onClick={() => setPanel({ kind: 'edit', id })} />
        <IconButton icon={X} label="Close" size={18} onClick={() => setPanel(null)} />
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading || !b ? (
          <div className="flex justify-center py-10">{isLoading ? <Spinner /> : <p className="text-sm text-ink-2">Not found.</p>}</div>
        ) : (
          <ReaderBody b={b} />
        )}
      </div>
    </PanelShell>
  );
}

function ReaderBody({ b }: { b: Bookmark }) {
  const { data: content, isLoading } = useContent(b.id, b.hasContent);
  const html = useMemo(() => (content?.html ? DOMPurify.sanitize(content.html) : null), [content]);
  const note = useMemo(() => (b.note ? markdown(b.note) : null), [b.note]);
  const yt = youtubeId(b.url);
  const isPdf = b.file?.mime === 'application/pdf';

  if (isPdf) return <iframe title={b.title} src={b.file!.url} className="size-full min-h-[80vh]" />;

  return (
    <article className="mx-auto max-w-[42rem] px-6 py-8">
      {b.type !== 'note' && <h1 className="text-2xl leading-tight font-bold">{b.title || b.url}</h1>}
      {b.type === 'note' && b.title && <h1 className="mb-4 text-2xl leading-tight font-bold">{b.title}</h1>}
      {b.type !== 'note' && (
        <p className="mt-2 text-sm text-ink-3">
          {b.site && <>{b.site} · </>}
          Saved {longDate(b.createdAt)}
        </p>
      )}

      {b.type !== 'note' && note && (
        <div className="reader mt-5 rounded-lg border-l-[3px] border-[#e2a336] bg-[#e2a336]/8 px-4 py-3 text-[0.95rem]" dangerouslySetInnerHTML={{ __html: note }} />
      )}

      <div className="mt-6">
        {yt ? (
          <div className="aspect-video overflow-hidden rounded-lg bg-black">
            <iframe
              title={b.title}
              src={`https://www.youtube-nocookie.com/embed/${yt}`}
              className="size-full"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        ) : b.type === 'image' && b.cover ? (
          <img src={b.file?.url ?? b.cover} alt={b.title} referrerPolicy="no-referrer" className="mx-auto max-h-[75vh] rounded-lg" />
        ) : b.file?.mime.startsWith('video/') ? (
          <video src={b.file.url} controls className="w-full rounded-lg" />
        ) : b.file?.mime.startsWith('audio/') ? (
          <audio src={b.file.url} controls className="w-full" />
        ) : b.type === 'note' ? (
          <div className="reader" dangerouslySetInnerHTML={{ __html: note ?? '' }} />
        ) : isLoading ? (
          <Spinner />
        ) : html ? (
          <div className="reader" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="rounded-lg bg-field px-5 py-6 text-center text-sm text-ink-2">
            {b.description && <p className="mb-3 text-ink">{b.description}</p>}
            No readable content was saved for this page.
            {b.url && (
              <a href={b.url} target="_blank" rel="noopener noreferrer" className="mt-3 block font-medium text-accent hover:underline">
                Open the original →
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

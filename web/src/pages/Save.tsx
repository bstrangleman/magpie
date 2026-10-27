import { CheckIcon } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import type { Bookmark } from '../../../shared/types.ts';
import { Logo, TagInput } from '../components/common.tsx';
import { CollectionSelect } from '../components/dialogs.tsx';
import { AutoTextarea, Button, ErrorText, Field, Input, Spinner } from '../components/ui.tsx';
import { UIContext, type UIState } from '../components/ui-context.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useCollections } from '../lib/queries.ts';

// Minimal UI context so shared components (collection picker) work outside the main layout.
const saveUI: UIState = {
  view: { kind: 'all' },
  q: '',
  setQuery: () => {},
  panel: null,
  setPanel: () => {},
  openDialog: () => {},
  closeDialog: () => {},
  sidebarOpen: false,
  setSidebarOpen: () => {},
};

/** Target of the "Save to Magpie" bookmarklet: /save?url=…&title=… */
export function SavePage() {
  const [params] = useSearchParams();
  const url = params.get('url') ?? '';
  const collections = useCollections();
  const [existing, setExisting] = useState<Bookmark | null | undefined>(undefined);
  const [title, setTitle] = useState(params.get('title') ?? '');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!url) return setExisting(null);
    api.get<{ bookmark: Bookmark | null }>(`/bookmarks/lookup?url=${encodeURIComponent(url)}`).then(
      ({ bookmark }) => {
        setExisting(bookmark);
        if (bookmark) {
          setTitle(bookmark.title || title);
          setNote(bookmark.note);
          setTags(bookmark.tags);
          setCollectionId(bookmark.collectionId);
        }
      },
      () => setExisting(null),
    );
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('saving');
    setError('');
    try {
      if (existing) await api.patch(`/bookmarks/${existing.id}`, { title, note, tags, collectionId });
      else await api.post('/bookmarks', { url, title, note, tags, collectionId, source: 'bookmarklet' });
      setState('saved');
      setTimeout(() => window.close(), 1200);
    } catch (err) {
      setError(errorMessage(err));
      setState('idle');
    }
  };

  if (!url) {
    return <Centered>Nothing to save — open this page from the Magpie bookmarklet.</Centered>;
  }
  if (existing === undefined) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  }
  if (state === 'saved') {
    return (
      <Centered>
        <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-ink">
          <CheckIcon size={26} weight="bold" />
        </span>
        <p className="mt-3 font-semibold">Saved to Magpie</p>
        <p className="text-sm text-ink-2">{collections.find((c) => c.id === collectionId)?.name ?? 'Unsorted'}</p>
      </Centered>
    );
  }

  return (
    <UIContext.Provider value={saveUI}>
      <form onSubmit={submit} className="mx-auto max-w-md space-y-3 p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <Logo size={26} />
          <h1 className="font-semibold">{existing ? 'Already saved — edit bookmark' : 'Save to Magpie'}</h1>
        </div>
        <p className="truncate rounded-md bg-field px-2.5 py-1.5 text-xs text-ink-2">{url}</p>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fetched automatically if empty" />
        </Field>
        <Field label="Collection">
          <CollectionSelect value={collectionId} onChange={setCollectionId} />
        </Field>
        <Field label="Tags">
          <TagInput value={tags} onChange={setTags} />
        </Field>
        <Field label="Note">
          <AutoTextarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => window.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={state === 'saving'}>
            {existing ? 'Update' : 'Save'}
          </Button>
        </div>
      </form>
    </UIContext.Provider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">{children}</div>;
}

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { BookmarkList } from '../components/BookmarkList.tsx';
import { BookmarkPanel } from '../components/BookmarkPanel.tsx';
import { AddLinkDialog } from '../components/dialogs.tsx';
import { Reader } from '../components/Reader.tsx';
import { Sidebar } from '../components/Sidebar.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { UIContext, type Panel, type UIState } from '../components/ui-context.tsx';
import { useSidebar } from '../lib/queries.ts';
import { cn } from '../lib/utils.ts';
import { viewFromPath } from '../lib/view.ts';

export function MainPage() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => viewFromPath(location.pathname), [location.pathname]);
  const q = params.get('q') ?? '';
  const [panel, setPanel] = useState<Panel>(null);
  const [dialog, setDialog] = useState<ReactNode>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: sidebar } = useSidebar();

  const ui = useMemo<UIState | null>(
    () =>
      view && {
        view,
        q,
        setQuery: (next) =>
          setParams(
            (p) => {
              if (next.trim()) p.set('q', next);
              else p.delete('q');
              return p;
            },
            { replace: true },
          ),
        panel,
        setPanel,
        openDialog: setDialog,
        closeDialog: () => setDialog(null),
        sidebarOpen,
        setSidebarOpen,
      },
    [view, q, panel, sidebarOpen, setParams],
  );

  // Paste a URL anywhere (outside a text field) to save it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || dialog) return;
      const text = e.clipboardData?.getData('text/plain').trim() ?? '';
      if (/^https?:\/\/\S+$/i.test(text)) {
        e.preventDefault();
        setDialog(<AddLinkDialog initialUrl={text} />);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [dialog]);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || dialog || document.querySelector('[role=dialog]')) return;
      // First Escape leaves the text field you're editing (saving it); the next one closes the panel.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur();
      else setPanel(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel, dialog]);

  const current = view?.kind === 'collection' ? sidebar?.collections.find((c) => c.id === view.id) : undefined;
  useDocumentTitle(current ? `${current.name} · Magpie` : 'Magpie');

  if (!ui || !view) return <Navigate to="/all" replace />;

  // A collection's colour tints the accent while you're inside it.
  const style = current?.color ? ({ '--accent': current.color } as CSSProperties) : undefined;

  return (
    <UIContext.Provider value={ui}>
      <div className="flex h-dvh overflow-hidden" style={style}>
        <div
          className={cn(
            'fixed inset-y-0 left-0 z-30 transition-transform md:static md:translate-x-0',
            sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
          )}
        >
          <Sidebar />
        </div>
        {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/25 md:hidden" onClick={() => setSidebarOpen(false)} />}
        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <BookmarkList key={`${location.pathname}`} />
        </main>
        {panel?.kind === 'edit' && <BookmarkPanel key={panel.id} id={panel.id} />}
        {panel?.kind === 'preview' && <Reader key={panel.id} id={panel.id} />}
      </div>
      {dialog}
    </UIContext.Provider>
  );
}

function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

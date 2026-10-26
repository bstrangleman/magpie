import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  AuthStatus,
  Backup,
  Bookmark,
  BookmarkContent,
  BookmarkPage,
  BulkAction,
  Collection,
  Me,
  Sidebar,
  Sort,
  Stats,
  UserSettings,
  ViewMode,
  ViewPrefs,
} from '../../../shared/types.ts';
import { ApiError, api } from './api.ts';
import { defaultSort, listQuery, timeZone, viewKey, type View } from './view.ts';

export const qk = {
  status: ['auth-status'] as const,
  me: ['me'] as const,
  sidebar: ['sidebar'] as const,
  bookmarks: ['bookmarks'] as const,
  list: (query: string) => ['bookmarks', query] as const,
  bookmark: (id: number) => ['bookmark', id] as const,
  content: (id: number) => ['content', id] as const,
  backups: ['backups'] as const,
  keys: ['keys'] as const,
};

export const useAuthStatus = () => useQuery({ queryKey: qk.status, queryFn: () => api.get<AuthStatus>('/auth/status') });

const isUnauthorized = (err: unknown) => err instanceof ApiError && err.status === 401;

/**
 * The signed-in user. A 401 means signed out; other failures (the server restarting during an
 * update, a dropped connection) are retried rather than treated as signed out.
 */
export const useMe = () =>
  useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<Me>('/me'),
    staleTime: Infinity,
    retry: (count, err) => !isUnauthorized(err) && count < 3,
    refetchInterval: (q) => (q.state.status === 'error' && !isUnauthorized(q.state.error) ? 5000 : false),
  });

export function useSettings(): UserSettings {
  const { data } = useMe();
  return data!.settings;
}

export const useSidebar = () => useQuery({ queryKey: qk.sidebar, queryFn: () => api.get<Sidebar>('/sidebar') });

export function useCollections(): Collection[] {
  return useSidebar().data?.collections ?? [];
}

const hasPending = (items: Bookmark[]) => items.some((b) => b.fetchStatus === 'pending');

export function useBookmarkList(view: View, q: string, sort: Sort) {
  const query = listQuery(view, q, sort);
  return useInfiniteQuery({
    queryKey: qk.list(query),
    queryFn: ({ pageParam }) => api.get<BookmarkPage>(`/bookmarks?${query}&offset=${pageParam}&limit=60`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    // Poll while metadata is still being fetched for something on screen.
    refetchInterval: (q) => (q.state.data?.pages.some((p) => hasPending(p.items)) ? 2500 : false),
  });
}

export const useBookmark = (id: number | null) =>
  useQuery({
    queryKey: qk.bookmark(id ?? 0),
    queryFn: () => api.get<Bookmark>(`/bookmarks/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.fetchStatus === 'pending' ? 2500 : false),
  });

export const useContent = (id: number, enabled: boolean) =>
  useQuery({ queryKey: qk.content(id), queryFn: () => api.get<BookmarkContent>(`/bookmarks/${id}/content`), enabled });

/** Apply a change to a bookmark wherever it appears in cached lists. */
export function patchCachedBookmark(qc: QueryClient, id: number, patch: (b: Bookmark) => Bookmark) {
  qc.setQueriesData<InfiniteData<BookmarkPage>>({ queryKey: qk.bookmarks }, (data) =>
    data && {
      ...data,
      pages: data.pages.map((p) => ({ ...p, items: p.items.map((b) => (b.id === id ? patch(b) : b)) })),
    },
  );
  qc.setQueryData<Bookmark>(qk.bookmark(id), (b) => b && patch(b));
}

export function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.bookmarks });
    qc.invalidateQueries({ queryKey: qk.sidebar });
    // Single bookmarks too, so an open edit panel or preview shows the change.
    qc.invalidateQueries({ queryKey: ['bookmark'] });
  };
}

export function useUpdateBookmark() {
  const qc = useQueryClient();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Bookmark> & { coverUrl?: string | null } }) =>
      api.patch<Bookmark>(`/bookmarks/${id}`, patch),
    onMutate: ({ id, patch }) => {
      if ('favorite' in patch) patchCachedBookmark(qc, id, (b) => ({ ...b, favorite: !!patch.favorite }));
    },
    onSuccess: (b) => {
      qc.setQueryData(qk.bookmark(b.id), b);
      patchCachedBookmark(qc, b.id, () => b);
    },
    onSettled: refresh,
  });
}

/** Bookmarks per bulk request (the server accepts up to 5,000). */
const BULK_CHUNK = 2000;

export function useBulk() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({ ids, ...action }: { ids: number[] } & BulkAction) => {
      const chunks: number[][] = [];
      for (let i = 0; i < ids.length; i += BULK_CHUNK) chunks.push(ids.slice(i, i + BULK_CHUNK));
      // Each move puts its bookmarks above what's already in the collection, so move the last
      // chunk first: the selection then ends up in its original order.
      if (action.action === 'move') chunks.reverse();
      let count = 0;
      for (const chunk of chunks) count += (await api.post<{ count: number }>('/bookmarks/bulk', { ids: chunk, ...action })).count;
      return { count };
    },
    onSettled: refresh,
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Omit<UserSettings, 'views'>> & { views?: Record<string, ViewPrefs | null> }) =>
      api.patch<UserSettings>('/settings', patch),
    onMutate: (patch) => {
      qc.setQueryData<Me>(qk.me, (me) => {
        if (!me) return me;
        const views = { ...me.settings.views };
        for (const [k, v] of Object.entries(patch.views ?? {})) {
          if (v === null) delete views[k];
          else views[k] = { ...views[k], ...v };
        }
        return { ...me, settings: { ...me.settings, ...patch, views } };
      });
    },
    onSuccess: (settings) => qc.setQueryData<Me>(qk.me, (me) => me && { ...me, settings }),
  });
}

/** The view mode + sort for a view, falling back to defaults. */
export function useViewPrefs(view: View, searching: boolean) {
  const settings = useSettings();
  const save = useSaveSettings();
  const key = viewKey(view);
  const prefs = settings.views[key] ?? {};
  const mode: ViewMode = prefs.view ?? settings.defaultView;
  let sort: Sort = prefs.sort ?? defaultSort(view);
  if (searching && (sort === 'manual' || !prefs.sort)) sort = 'relevance';
  if (!searching && sort === 'relevance') sort = defaultSort(view);
  return {
    mode,
    sort,
    setMode: (v: ViewMode) => save.mutate({ views: { [key]: { view: v } } }),
    setSort: (s: Sort) => save.mutate({ views: { [key]: { sort: s } } }),
  };
}

export const useBackups = () => useQuery({ queryKey: qk.backups, queryFn: () => api.get<Backup[]>('/backups') });

/** Usage statistics, bucketed by the viewer's time zone. */
export const useStats = () =>
  useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<Stats>(`/stats?tz=${encodeURIComponent(timeZone())}`),
  });

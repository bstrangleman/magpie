import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { Toaster } from './components/toast.tsx';
import { Button, Spinner } from './components/ui.tsx';
import { ApiError } from './lib/api.ts';
import { useMe } from './lib/queries.ts';
import { AuthPage } from './pages/Auth.tsx';
import { MainPage } from './pages/Main.tsx';
import { SavePage } from './pages/Save.tsx';
import { SettingsLayout, SettingsSection } from './pages/Settings.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

/** Applies the user's theme + font size to <html>, and remembers them for the next page load. */
function useTheme(theme: string | undefined, largeFont: boolean | undefined) {
  useEffect(() => {
    if (!theme) return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', resolved === 'dark' ? '#1c1c1e' : resolved === 'sepia' ? '#faf4e8' : '#ffffff');
    };
    apply();
    media.addEventListener('change', apply);
    try {
      localStorage.setItem('magpie:theme', theme);
    } catch {}
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    if (largeFont === undefined) return;
    document.documentElement.classList.toggle('large-font', largeFont);
    try {
      localStorage.setItem('magpie:largeFont', largeFont ? '1' : '0');
    } catch {}
  }, [largeFont]);
}

function RequireAuth() {
  const { data: me, error, isLoading, refetch, isFetching } = useMe();
  const location = useLocation();
  useTheme(me?.settings.theme, me?.settings.largeFont);

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }
  if (!me && !(error instanceof ApiError && error.status === 401)) {
    // Not a sign-out: the server is restarting (say, during an update) or unreachable. useMe keeps retrying.
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-semibold">Can’t reach Magpie</p>
        <p className="max-w-sm text-sm text-ink-2">The server isn’t responding. This page will reconnect when it’s back.</p>
        <Button onClick={() => refetch()} loading={isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  if (!me) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />;
  }
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: '/login', element: <AuthPage mode="login" /> },
  { path: '/signup', element: <AuthPage mode="signup" /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <Navigate to="/all" replace /> },
      { path: '/save', element: <SavePage /> },
      {
        path: '/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="/settings/app" replace /> },
          { path: ':section', element: <SettingsSection /> },
        ],
      },
      { path: '*', element: <MainPage /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}

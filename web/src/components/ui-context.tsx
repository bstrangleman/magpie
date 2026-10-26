import { createContext, useContext, type ReactNode } from 'react';
import type { View } from '../lib/view.ts';

export type Panel = { kind: 'edit' | 'preview'; id: number } | null;

export interface UIState {
  view: View;
  q: string;
  setQuery: (q: string) => void;
  panel: Panel;
  setPanel: (p: Panel) => void;
  openDialog: (node: ReactNode) => void;
  closeDialog: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export const UIContext = createContext<UIState | null>(null);

export function useUI(): UIState {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside the main layout');
  return ctx;
}

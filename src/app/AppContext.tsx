import { createContext, useContext } from 'react';
import type { AppController } from './controller';
import { useStore } from '../state/store';
import type { UIState } from '../state/ui-state';

const AppContext = createContext<AppController | null>(null);
export const AppProvider = AppContext.Provider;

export function useApp(): AppController {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp() outside <AppProvider>');
  return app;
}

// Subscribe to one slice of the UI state. Components re-render only when their slice changes.
export function useUI<S>(selector: (ui: UIState) => S): S {
  return useStore(useApp().ui, selector);
}

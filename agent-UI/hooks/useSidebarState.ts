import { useCallback, useState } from 'react';
import { SIDEBAR_DEFAULT_WIDTH } from '../constants';

export type SidebarSide = 'left' | 'right';

export interface SidebarState {
  side: SidebarSide;
  width: number;
  open: boolean;
}

export interface SidebarActions {
  setSide: (side: SidebarSide) => void;
  setWidth: (width: number) => void;
  setOpen: (open: boolean) => void;
}

function storageKey(id: string | undefined, suffix: string): string {
  return id ? `agent-sdk:sidebar-${suffix}:${id}` : `agent-sdk:sidebar-${suffix}`;
}

function readStored<T>(key: string, fallback: T, parse: (v: string) => T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function useSidebarState(
  id: string | undefined,
  defaultWidth: number = SIDEBAR_DEFAULT_WIDTH,
): SidebarState & SidebarActions {
  const [side, setSideState] = useState<SidebarSide>(() =>
    readStored<SidebarSide>(storageKey(id, 'side'), 'right', (v) =>
      v === 'left' || v === 'right' ? v : 'right',
    ),
  );

  const [width, setWidthState] = useState<number>(() =>
    readStored(storageKey(id, 'width'), defaultWidth, (v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : defaultWidth;
    }),
  );

  const [open, setOpenState] = useState<boolean>(() =>
    readStored(storageKey(id, 'open'), true, (v) => v === 'true'),
  );

  const persist = useCallback(
    (suffix: string, value: string) => {
      try {
        localStorage.setItem(storageKey(id, suffix), value);
      } catch {
        /* storage unavailable — ignore */
      }
    },
    [id],
  );

  const setSide = useCallback(
    (s: SidebarSide) => {
      setSideState(s);
      persist('side', s);
    },
    [persist],
  );

  const setWidth = useCallback(
    (w: number) => {
      setWidthState(w);
      persist('width', String(w));
    },
    [persist],
  );

  const setOpen = useCallback(
    (o: boolean) => {
      setOpenState(o);
      persist('open', String(o));
    },
    [persist],
  );

  return { side, width, open, setSide, setWidth, setOpen };
}

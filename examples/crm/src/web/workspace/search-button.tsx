import { Button } from '@shadalaya/react/button';
import { Kbd } from '@shadalaya/react/kbd';
import { SearchIcon } from 'lucide-react';
import { lazy, useEffect, useState } from 'react';
import { LazyPage } from '../ui/lazy-page.js';

// The palette's code loads on first open, or sooner, when the pointer or
// focus reaches the button: only the button and the shortcut are at startup.
const load = () => import('./search-palette.js');
const SearchPalette = lazy(load);

/** Whether the keyboard says ⌘ or Ctrl. */
const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * "Search…" in the top bar, with its shortcut, ⌘K or Ctrl+K anywhere in
 * the app: it opens the search palette. Closing returns focus to whatever
 * had it.
 */
export function SearchButton() {
  const [open, setOpen] = useState(false);
  // Once opened, the palette stays mounted, closed, so it reopens at once.
  const [opened, setOpened] = useState(false);
  const show = () => {
    setOpened(true);
    setOpen(true);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpened(true);
        setOpen((now) => !now);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={show}
        onPointerEnter={() => void load()}
        onFocus={() => void load()}
      >
        <SearchIcon />
        Search…
        <Kbd aria-hidden>{mac ? '⌘K' : 'Ctrl K'}</Kbd>
      </Button>
      {opened ? (
        <LazyPage fallback={null}>
          <SearchPalette open={open} onOpenChange={setOpen} />
        </LazyPage>
      ) : null}
    </>
  );
}

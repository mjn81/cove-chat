import { Suspense, lazy, useEffect, useRef } from 'react';

// The picker, its dataset (about 400 KB) and the sprite logic are a separate chunk: nothing of it is in first load.
const EmojiPickerBody = lazy(() => import('@/domains/emoji/components/emoji-picker-body'));

interface EmojiPickerProps {
  /** Receives the text to insert: the emoji character, or a `:name:` shortcode for a custom emoji (in `native`). */
  onSelect: (emoji: { native: string }, info: { keyboard: boolean }) => void;
  onClickOutside: () => void;
  /** Ignored: the picker follows the app theme tokens. Kept so existing callers need no change. */
  theme?: 'light' | 'dark';
}

/**
 * The emoji-only picker used by the Whisper composer (the normal composer uses the emoji + sticker panel).
 * Loads lazily; stays open after a pick and closes on a click outside or Escape.
 */
export default function EmojiPicker({ onSelect, onClickOutside }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as Element | null;
      // The emoji button toggles the picker itself; a style menu renders in a portal outside the picker.
      if (target?.closest?.('[data-emoji-toggle], [role="listbox"], [data-radix-popper-content-wrapper]')) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClickOutside();
    document.addEventListener('pointerdown', handler);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', handler);
      document.removeEventListener('keydown', key);
    };
  }, [onClickOutside]);

  return (
    <div ref={ref} className="w-full">
      <Suspense
        fallback={
          <div className="h-[380px] rounded-lg border border-border bg-popover" aria-hidden="true" />
        }
      >
        <EmojiPickerBody onSelect={(text, info) => onSelect({ native: text }, info)} />
      </Suspense>
    </div>
  );
}

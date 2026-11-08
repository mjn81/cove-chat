import { Suspense, lazy, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

// The picker, its dataset (about 400 KB) and the sprite logic are a separate chunk: nothing of it is in first load.
const EmojiPickerBody = lazy(() => import('@/domains/emoji/components/emoji-picker-body'));

interface EmojiPickerProps {
  /** Receives the text to insert: the emoji character, or a `:name:` shortcode for a custom emoji (in `native`). */
  onSelect: (emoji: { native: string }) => void;
  onClickOutside: () => void;
  /** Ignored: the picker follows the app theme tokens. Kept so existing callers need no change. */
  theme?: 'light' | 'dark';
}

/**
 * The emoji-only picker used by the Whisper composer (the normal composer uses the emoji + sticker panel).
 * Loads lazily and closes on a click outside.
 */
export default function EmojiPicker({ onSelect, onClickOutside }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [onClickOutside]);

  return (
    <div ref={ref} className="w-full">
      <Suspense
        fallback={
          <div className="flex h-[380px] items-center justify-center rounded-lg border border-border bg-popover text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
          </div>
        }
      >
        <EmojiPickerBody onSelect={(text) => onSelect({ native: text })} />
      </Suspense>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';

interface EmojiPickerProps {
  onSelect: (emoji: { native: string }) => void;
  onClickOutside: () => void;
  theme?: 'light' | 'dark';
}

export default function EmojiPicker({ onSelect, onClickOutside, theme = 'dark' }: EmojiPickerProps) {
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
    <div ref={ref} className="w-full [&_em-emoji-picker]:w-full [&_em-emoji-picker]:max-w-full">
      <Picker
        data={data}
        onEmojiSelect={onSelect}
        theme={theme}
        previewPosition="none"
        skinTonePosition="none"
        navPosition="bottom"
        dynamicWidth
      />
    </div>
  );
}

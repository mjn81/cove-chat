import { useCallback, useRef } from 'react';

/** What the attach menu asks for; decides the file dialog filter and whether images are sent as documents. */
export type UploadMode = 'media' | 'audio' | 'file';

const ACCEPT: Record<UploadMode, string> = {
	media: 'image/*,video/*',
	audio: 'audio/*',
	file: '*/*',
};

/**
 * Hidden `<input type="file">` plus an `open(mode)` function that configures
 * its filter before opening the dialog. Shared by the standard and Whisper
 * composers.
 *
 * @param onFiles - Receives the chosen files and whether they were picked as "Document / File".
 * @returns `inputProps` to spread on an `<input>` and `open` for the attach menu.
 */
export function useFilePicker(onFiles: (files: File[], asDocument: boolean) => void) {
	const inputRef = useRef<HTMLInputElement>(null);
	const asDocumentRef = useRef(false);

	const open = useCallback((mode: UploadMode) => {
		const input = inputRef.current;
		if (!input) return;
		asDocumentRef.current = mode === 'file';
		input.accept = ACCEPT[mode];
		input.value = '';
		input.click();
	}, []);

	const inputProps = {
		ref: inputRef,
		type: 'file' as const,
		multiple: true,
		className: 'hidden',
		onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files;
			if (files && files.length > 0) onFiles(Array.from(files), asDocumentRef.current);
		},
	};

	return { open, inputProps };
}

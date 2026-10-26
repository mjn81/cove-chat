import { useEffect, useState } from 'react';

/**
 * Window-wide drag-and-drop for files. `isDragging` drives the full-screen
 * drop overlay; dropped files are handed to `onFiles`.
 *
 * @param onFiles - Called with the dropped files.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => {
		const onDragOver = (e: DragEvent) => {
			e.preventDefault();
			setIsDragging(true);
		};
		// relatedTarget is null only when the pointer leaves the window itself.
		const onDragLeave = (e: DragEvent) => {
			if (e.relatedTarget === null) setIsDragging(false);
		};
		const onDrop = (e: DragEvent) => {
			e.preventDefault();
			setIsDragging(false);
			if (e.dataTransfer?.files) onFiles(Array.from(e.dataTransfer.files));
		};

		window.addEventListener('dragover', onDragOver);
		window.addEventListener('dragleave', onDragLeave);
		window.addEventListener('drop', onDrop);
		return () => {
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('dragleave', onDragLeave);
			window.removeEventListener('drop', onDrop);
		};
	}, [onFiles]);

	return isDragging;
}

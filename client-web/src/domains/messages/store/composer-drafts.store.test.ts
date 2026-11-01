import { beforeEach, describe, expect, it } from 'vitest';

import type { QueuedAttachment } from '../hooks/use-attachments';
import { useComposerDrafts } from './composer-drafts.store';

const file = (id: string): QueuedAttachment => ({
	file: new File(['x'], `${id}.txt`),
	id,
	status: 'idle',
	progress: 0,
});

describe('composer drafts', () => {
	beforeEach(() => useComposerDrafts.setState({ drafts: {} }));

	it('keeps the typed text per chat', () => {
		useComposerDrafts.getState().setText('a', 'hello');
		useComposerDrafts.getState().setText('b', 'other');
		expect(useComposerDrafts.getState().drafts.a.text).toBe('hello');
		expect(useComposerDrafts.getState().drafts.b.text).toBe('other');
	});

	it('keeps queued attachments per chat and updates them from the previous list', () => {
		const { setFiles } = useComposerDrafts.getState();
		setFiles('a', () => [file('1')]);
		setFiles('a', (prev) => [...prev, file('2')]);
		expect(useComposerDrafts.getState().drafts.a.files.map((f) => f.id)).toEqual(['1', '2']);
		expect(useComposerDrafts.getState().drafts.b).toBeUndefined();
	});

	it('forgets a draft once both text and files are empty, so nothing leaks', () => {
		const s = useComposerDrafts.getState();
		s.setText('a', 'hi');
		s.setFiles('a', () => [file('1')]);
		s.setText('a', '');
		expect(useComposerDrafts.getState().drafts.a).toBeDefined();
		s.setFiles('a', () => []);
		expect(useComposerDrafts.getState().drafts.a).toBeUndefined();
	});

	it('clear removes a chat’s draft', () => {
		const s = useComposerDrafts.getState();
		s.setText('a', 'hi');
		s.clear('a');
		expect(useComposerDrafts.getState().drafts.a).toBeUndefined();
	});
});

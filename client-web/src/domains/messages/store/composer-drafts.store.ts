import { create } from 'zustand';

import type { QueuedAttachment } from '../hooks/use-attachments';

/** What the user has typed or attached in one chat but not sent yet. */
interface Draft {
	text: string;
	files: QueuedAttachment[];
}

interface ComposerDraftsState {
	/** Drafts by channel id. Held in memory only: File objects cannot be persisted, and drafts need not outlive the tab. */
	drafts: Record<string, Draft>;
	setText: (channelId: string, text: string) => void;
	setFiles: (channelId: string, update: (prev: QueuedAttachment[]) => QueuedAttachment[]) => void;
	clear: (channelId: string) => void;
}

/** Returns `drafts` with the chat's entry replaced, or removed when it has nothing left in it. */
function withDraft(drafts: Record<string, Draft>, channelId: string, draft: Draft): Record<string, Draft> {
	const next = { ...drafts };
	if (draft.text === '' && draft.files.length === 0) delete next[channelId];
	else next[channelId] = draft;
	return next;
}

/**
 * The composer's unsent text and attachments, per chat. They live outside the composer component because the web
 * client renders a different layout tree on phone and desktop widths: crossing the breakpoint (rotating a tablet,
 * resizing the window) remounts the composer, which used to throw away what the user had typed and attached.
 */
export const useComposerDrafts = create<ComposerDraftsState>((set) => ({
	drafts: {},
	setText: (channelId, text) =>
		set((s) => ({ drafts: withDraft(s.drafts, channelId, { text, files: s.drafts[channelId]?.files ?? [] }) })),
	setFiles: (channelId, update) =>
		set((s) => ({
			drafts: withDraft(s.drafts, channelId, {
				text: s.drafts[channelId]?.text ?? '',
				files: update(s.drafts[channelId]?.files ?? []),
			}),
		})),
	clear: (channelId) => set((s) => ({ drafts: withDraft(s.drafts, channelId, { text: '', files: [] }) })),
}));

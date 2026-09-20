import { describe, it, expect, vi } from 'vitest';
import { buildMessagePreview } from './messagePreview';
import type { Channel } from '@/types/api';

vi.mock('@/ws', () => ({
	decryptText: vi.fn(async (_channelId: string, ciphertext: string) => `decrypted:${ciphertext}`),
}));

describe('buildMessagePreview', () => {
	const currentUserId = 'user-me';

	const dmChannel: Channel = {
		id: 'dm-1',
		name: '',
		creator_id: 'user-me',
		user_role: 0,
		is_private: true,
		created_at: new Date().toISOString(),
		members: ['user-me', 'user-other'],
		member_names: {
			'user-me': 'MeMyself',
			'user-other': 'Alice',
		},
	};

	const groupChannel: Channel = {
		id: 'grp-1',
		name: 'General',
		creator_id: 'user-other',
		user_role: 0,
		is_private: false,
		created_at: new Date().toISOString(),
		members: ['user-me', 'user-other', 'user-3'],
		member_names: {
			'user-me': 'MeMyself',
			'user-other': 'Alice',
			'user-3': 'Bob',
		},
	};

	it('returns "You: <text>" for direct messages sent by the current user', async () => {
		const preview = await buildMessagePreview(
			dmChannel,
			currentUserId,
			'text',
			'hello-world',
			'nonce1',
			currentUserId,
		);
		expect(preview).toBe('You: decrypted:hello-world');
	});

	it('returns "<username>: <text>" for direct messages sent by the other user', async () => {
		const preview = await buildMessagePreview(
			dmChannel,
			'user-other',
			'text',
			'hey-there',
			'nonce2',
			currentUserId,
		);
		expect(preview).toBe('Alice: decrypted:hey-there');
	});

	it('returns "You: [voice]" for voice message sent by current user in DM', async () => {
		const preview = await buildMessagePreview(
			dmChannel,
			currentUserId,
			'voice',
			'',
			'',
			currentUserId,
		);
		expect(preview).toBe('You: [voice]');
	});

	it('returns "<username>: [file]" for file message sent by other user in DM', async () => {
		const preview = await buildMessagePreview(
			dmChannel,
			'user-other',
			'file',
			'',
			'',
			currentUserId,
		);
		expect(preview).toBe('Alice: [file]');
	});

	it('returns "You: <text>" for group messages sent by the current user', async () => {
		const preview = await buildMessagePreview(
			groupChannel,
			currentUserId,
			'text',
			'group-msg',
			'nonce3',
			currentUserId,
		);
		expect(preview).toBe('You: decrypted:group-msg');
	});

	it('returns "<username>: <text>" for group messages sent by another member', async () => {
		const preview = await buildMessagePreview(
			groupChannel,
			'user-other',
			'text',
			'from-alice',
			'nonce4',
			currentUserId,
		);
		expect(preview).toBe('Alice: decrypted:from-alice');
	});

	it('falls back to channel display name if member_names lookup is missing in DM', async () => {
		const dmWithoutNames: Channel = {
			...dmChannel,
			member_names: undefined,
		};
		const preview = await buildMessagePreview(
			dmWithoutNames,
			'user-other',
			'text',
			'mystery',
			'nonce5',
			currentUserId,
		);
		expect(preview).toBe('user-other: decrypted:mystery');
	});
});

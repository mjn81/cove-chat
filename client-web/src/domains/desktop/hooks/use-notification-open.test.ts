import { beforeEach, describe, expect, it } from 'vitest';

import { useChannelStore } from '@/store/store';
import type { Channel } from '@/types/api';
import { openNotificationTarget } from './use-notification-open';

const channel = { id: 'c1', unread_count: 2 } as Channel;

describe('openNotificationTarget', () => {
	beforeEach(() => useChannelStore.setState({ channels: [channel], activeChannel: null }));

	it('opens the clicked chat', () => {
		expect(openNotificationTarget({ kind: 'message', channel_id: 'c1' })).toBe(true);
		expect(useChannelStore.getState().activeChannel?.id).toBe('c1');
	});

	it('ignores targets with no known chat', () => {
		expect(openNotificationTarget({ kind: 'whisper', channel_id: '' })).toBe(false);
		expect(openNotificationTarget({ kind: 'message', channel_id: 'gone' })).toBe(false);
		expect(useChannelStore.getState().activeChannel).toBeNull();
	});
});

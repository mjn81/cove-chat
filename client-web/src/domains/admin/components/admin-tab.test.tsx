import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { useAuthStore } from '@/store/store';
import type { AuthUser } from '@/types/api';
import { AdminTab } from './admin-tab';

describe('AdminTab', () => {
	it('renders nothing for an account without a server role', () => {
		useAuthStore.setState({ user: { id: 'u1', username: 'member' } as AuthUser });
		const { container } = render(<AdminTab />);
		expect(container).toBeEmptyDOMElement();
	});

	it('renders nothing when signed out', () => {
		useAuthStore.setState({ user: null });
		const { container } = render(<AdminTab />);
		expect(container).toBeEmptyDOMElement();
	});
});

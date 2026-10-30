import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SessionInfo } from '../types/sessions.types';

vi.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/client', () => ({ APIError: class APIError extends Error {} }));

const terminate = vi.fn();
const terminateOthers = vi.fn();
let sessions: SessionInfo[] | undefined;

vi.mock('../api/use-sessions', () => ({
	useGetSessions: () => ({ data: sessions, isLoading: false, isError: false }),
	useTerminateSession: () => ({ mutate: terminate, isPending: false }),
	useTerminateOtherSessions: () => ({ mutate: terminateOthers, isPending: false }),
}));
// The real modal portals into the document; a plain stand-in keeps the test about this component's wiring.
vi.mock('@/components/ConfirmModal', () => ({
	ConfirmModal: ({ isOpen, onConfirm, confirmText }: { isOpen: boolean; onConfirm: () => void; confirmText?: string }) =>
		isOpen ? <button onClick={onConfirm}>{`confirm:${confirmText}`}</button> : null,
}));

const { DevicesSection } = await import('./devices-section');

const session = (over: Partial<SessionInfo>): SessionInfo => ({
	id: 's1',
	device_name: 'Chrome on Windows',
	app_name: 'Cove Web',
	platform: 'Windows',
	ip: '203.0.113.7',
	created_at: '2026-10-29T10:00:00Z',
	last_active_at: new Date().toISOString(),
	current: false,
	...over,
});

describe('DevicesSection', () => {
	beforeEach(() => {
		terminate.mockClear();
		terminateOthers.mockClear();
	});

	it('shows this device, the other devices with their location, and a terminate-all action', () => {
		sessions = [
			session({ id: 'me', device_name: 'Cove Desktop on Windows', app_name: 'Cove Desktop 0.9.0', current: true }),
			session({ id: 'other', device_name: 'Firefox on Linux', city: 'Tehran', country: 'Iran' }),
		];
		render(<DevicesSection />);

		expect(screen.getByText('devices.thisDevice')).toBeTruthy();
		expect(screen.getByText('Cove Desktop on Windows')).toBeTruthy();
		expect(screen.getByText('Firefox on Linux')).toBeTruthy();
		expect(screen.getByText(/Tehran, Iran/)).toBeTruthy();
		expect(screen.getByText('devices.terminateOthers')).toBeTruthy();
	});

	it('terminates a single session only after confirmation', () => {
		sessions = [session({ id: 'me', current: true }), session({ id: 'other', device_name: 'Firefox on Linux' })];
		render(<DevicesSection />);

		fireEvent.click(screen.getByLabelText('devices.terminate'));
		expect(terminate).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText('confirm:devices.terminate'));
		expect(terminate).toHaveBeenCalledWith('other', expect.anything());
	});

	it('hides terminate-all and says so when this is the only device', () => {
		sessions = [session({ id: 'me', current: true })];
		render(<DevicesSection />);

		expect(screen.queryByText('devices.terminateOthers')).toBeNull();
		expect(screen.getByText('devices.noOthers')).toBeTruthy();
	});
});

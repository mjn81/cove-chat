import { createHash } from 'node:crypto';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n/index';

const mocks = vi.hoisted(() => ({ apiServerInfo: vi.fn(), apiCaptchaChallenge: vi.fn() }));

vi.mock('@/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/api/client')>()),
	apiServerInfo: mocks.apiServerInfo,
	apiCaptchaChallenge: mocks.apiCaptchaChallenge,
}));

import RegisterPage from './RegisterPage';

/** A challenge the way the server issues it, for a known secret. */
function challenge(secret = 321, maxnumber = 2000) {
	const salt = `0a1b2c3d4e5f60718293a4b5?expires=${Math.floor(Date.now() / 1000) + 300}`;
	return {
		algorithm: 'SHA-256',
		challenge: createHash('sha256').update(salt + secret).digest('hex'),
		maxnumber,
		salt,
		signature: 'server-signature',
	};
}

function renderPage() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<RegisterPage />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

const continueButton = () => screen.getByRole('button', { name: 'Continue' });

describe('RegisterPage sign-up check', () => {
	beforeEach(() => {
		mocks.apiServerInfo.mockReset();
		mocks.apiCaptchaChallenge.mockReset();
	});

	it('shows the check, solves it by itself and then enables Continue', async () => {
		mocks.apiServerInfo.mockResolvedValue({ registration_mode: 'open', needs_owner: false, captcha_required: true });
		// A large range so the check is still running when the button is inspected.
		mocks.apiCaptchaChallenge.mockResolvedValue(challenge(150_000, 150_000));

		renderPage();

		expect(await screen.findByText('Checking that you are human…')).toBeInTheDocument();
		expect(continueButton()).toBeDisabled();
		expect(await screen.findByText('You are verified', {}, { timeout: 10_000 })).toBeInTheDocument();
		expect(continueButton()).toBeEnabled();
		expect(mocks.apiCaptchaChallenge).toHaveBeenCalledTimes(1);
	});

	it('shows no check when the server does not require one', async () => {
		mocks.apiServerInfo.mockResolvedValue({ registration_mode: 'open', needs_owner: false, captcha_required: false });

		renderPage();

		await screen.findByRole('button', { name: 'Continue' });
		expect(screen.queryByText('Checking that you are human…')).not.toBeInTheDocument();
		expect(screen.queryByText('You are verified')).not.toBeInTheDocument();
		expect(mocks.apiCaptchaChallenge).not.toHaveBeenCalled();
		expect(continueButton()).toBeEnabled();
	});

	it('offers a retry when the challenge cannot be fetched', async () => {
		mocks.apiServerInfo.mockResolvedValue({ registration_mode: 'open', needs_owner: false, captcha_required: true });
		mocks.apiCaptchaChallenge.mockRejectedValueOnce(new Error('network')).mockResolvedValue(challenge());

		renderPage();

		expect(await screen.findByText('The check could not be completed.')).toBeInTheDocument();
		expect(continueButton()).toBeDisabled();
		screen.getByRole('button', { name: 'Try again' }).click();
		expect(await screen.findByText('You are verified')).toBeInTheDocument();
	});
});

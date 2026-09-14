// auth.slice.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { apiLogin, apiRegister, apiLogout, apiMe, apiUpdateProfile, apiDeleteAccount } from '@/api/client';
import type { AuthUser } from '@/types/api';
import { isWails } from '@/utils/wails';

import { connectWS, disconnectWS } from './ws.manager';
import { useChannelStore } from './channels.slice';

// The web client authenticates via an httpOnly session cookie and never
// touches the token itself. The desktop (Wails) client still needs it in
// localStorage, since its webview doesn't reliably persist httpOnly cookies.
function persistDesktopToken(token: string | undefined) {
	if (!isWails() || !token) return;
	try {
		localStorage.setItem('nodetalk_token', token);
	} catch {
		// Ignore access errors
	}
}

function clearDesktopToken() {
	if (!isWails()) return;
	try {
		localStorage.removeItem('nodetalk_token');
	} catch {
		// Ignore access errors
	}
}

export interface AuthSlice {
	user: AuthUser | null;
	isAuthLoading: boolean;

	initAuth: () => Promise<void>;
	login: (u: string, p: string) => Promise<void>;
	register: (u: string, p: string) => Promise<void>;
	logout: () => Promise<void>;
	updateUser: (data: { avatar_id?: string; username?: string; custom_msg?: string; status_preference?: string; password?: string; old_password?: string }) => Promise<void>;
	updateStatus: (status: string) => void;
	deleteAccount: () => Promise<void>;
}

export const useAuthStore = create<AuthSlice>()(
	persist(
		(set, get) => ({
			user: null,
			isAuthLoading: true,

			initAuth: async () => {
				const saved = get().user;

				if (saved) {
					try {
						// Verify session is still valid on server and get fresh data
						const fresh = await apiMe();
						set({ user: fresh, isAuthLoading: false });
						connectWS(fresh.token);
						useChannelStore.getState().refreshChannels();
					} catch (err: any) {
						// Only clear session if it's a definitive 401 Unauthorized
						// If it's a network error or 500, we keep the 'saved' user state
						// so the app doesn't flick back to login incorrectly.
						if (err?.status === 401) {
							set({ user: null, isAuthLoading: false });
							disconnectWS();
						} else {
							// Network error or server blip - stay "logged in" locally
							// but the UI will show connection errors via WS state.
							set({ isAuthLoading: false });
							connectWS(saved.token);
							useChannelStore.getState().refreshChannels().catch(() => {});
						}
					}
				} else {
					set({ isAuthLoading: false });
				}
			},

			login: async (u, p) => {
				const user = await apiLogin(u, p);
				set({ user });

				// Desktop only: the token is otherwise carried by the httpOnly
				// session cookie the backend just set, invisible to this code.
				persistDesktopToken(user.token);

				connectWS(user.token);
				useChannelStore.getState().refreshChannels();
			},

			register: async (u, p) => {
				await apiRegister(u, p);
				await get().login(u, p);
			},

			logout: async () => {
				await apiLogout().catch(() => {});

				disconnectWS();
				useChannelStore.getState().resetChannels();
				clearDesktopToken();

				set({ user: null });
			},

			updateUser: async (data) => {
				const fresh = await apiUpdateProfile(data);
				set({ user: fresh });
			},
			updateStatus: (status) => {
				set((state) => {
					if (!state.user) return state;
					return { user: { ...state.user, status } };
				});
			},

			deleteAccount: async () => {
				await apiDeleteAccount();
				disconnectWS();
				useChannelStore.getState().resetChannels();
				set({ user: null });
			},
		}),
		{
			name: 'auth',
			// Never persist the raw session token: the web client relies solely
			// on the httpOnly cookie, and the desktop client keeps its own copy
			// via persistDesktopToken. Keeping it here too just gives an extra
			// place a leaked-localStorage attack (or a stale logout) could read
			// a valid session from.
			partialize: (s) => ({
				user: s.user ? { ...s.user, token: undefined } : null,
			}),
		},
	),
);

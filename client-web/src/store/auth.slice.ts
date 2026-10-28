// auth.slice.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { apiLogin, apiRegister, apiLogout, apiMe, apiUpdateProfile, apiDeleteAccount, apiGetMyRelationships, apiGetIncomingRequests, apiRelationshipAction } from '@/api/client';
import type { AuthUser, RelationshipResponse, RelationshipAction } from '@/types/api';
import { isWails } from '@/utils/wails';

import { connectWS, disconnectWS } from './ws.manager';
import { useChannelStore } from './channels.slice';
import { evictStaleAvatars, prewarmAvatars } from '@/lib/avatarCache';

// The web client authenticates via an httpOnly session cookie and never
// touches the token itself. The desktop (Wails) client still needs it in
// localStorage, since its webview doesn't reliably persist httpOnly cookies.
function persistDesktopToken(token: string | undefined) {
	if (!isWails() || !token) return;
	try {
		localStorage.setItem('cove_token', token);
	} catch {
		// Ignore access errors
	}
}

function clearDesktopToken() {
	if (!isWails()) return;
	try {
		localStorage.removeItem('cove_token');
	} catch {
		// Ignore access errors
	}
}

export interface AuthSlice {
	user: AuthUser | null;
	isAuthLoading: boolean;
	relationships: RelationshipResponse[];
	incomingRequests: RelationshipResponse[];

	initAuth: () => Promise<void>;
	login: (u: string, p: string) => Promise<void>;
	register: (u: string, p: string, inviteCode?: string, turnstileToken?: string) => Promise<void>;
	logout: () => Promise<void>;
	fetchRelationships: () => Promise<void>;
	fetchIncomingRequests: () => Promise<void>;
	relationshipAction: (userId: string, action: RelationshipAction) => Promise<RelationshipResponse>;
	updateUser: (data: {
		avatar_id?: string;
		avatar_ids?: string[];
		banner_color?: string;
		username?: string;
		custom_msg?: string;
		status_preference?: string;
		password?: string;
		old_password?: string;
		allow_channel_adds?: string;
		dm_permission?: string;
		friend_request_permission?: string;
	}) => Promise<void>;
	updateStatus: (status: string) => void;
	deleteAccount: () => Promise<void>;
}

export const useAuthStore = create<AuthSlice>()(
	persist(
		(set, get) => ({
			user: null,
			isAuthLoading: true,
			relationships: [],
			incomingRequests: [],

			initAuth: async () => {
				try {
					const saved = get().user;

					if (saved) {
						try {
							// Verify session is still valid on server and get fresh data
							const fresh = await apiMe();
							set({ user: fresh });

							// Check for avatar updates and invalidate any deleted avatars on reload
							const savedAvatars = [
								...(saved.avatar_ids || []),
								...(saved.avatar_id ? [saved.avatar_id] : []),
							];
							const freshAvatars = [
								...(fresh.avatar_ids || []),
								...(fresh.avatar_id ? [fresh.avatar_id] : []),
							];
							// Evict any avatar that was present in saved state but is no longer in fresh state
							evictStaleAvatars(freshAvatars, savedAvatars).catch(() => {});
							// Pre-warm the cache for active avatars
							prewarmAvatars(freshAvatars).catch(() => {});

							connectWS(fresh.token);
							useChannelStore.getState().refreshChannels().catch(() => {});
							get().fetchRelationships().catch(() => {});
							get().fetchIncomingRequests().catch(() => {});
						} catch (err: any) {
							// Only clear session if it's a definitive 401 Unauthorized
							// If it's a network error or 500, we keep the 'saved' user state
							// so the app doesn't flick back to login incorrectly.
							if (err?.status === 401) {
								set({ user: null, relationships: [], incomingRequests: [] });
								disconnectWS();
							} else {
								// Network error or server blip - stay "logged in" locally
								// but the UI will show connection errors via WS state.
								connectWS(saved.token);
								useChannelStore.getState().refreshChannels().catch(() => {});
								get().fetchRelationships().catch(() => {});
								get().fetchIncomingRequests().catch(() => {});
							}
						}
					}
				} finally {
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
				get().fetchRelationships();
				get().fetchIncomingRequests();
			},

			register: async (u, p, inviteCode, turnstileToken) => {
				await apiRegister(u, p, inviteCode, turnstileToken);
				await get().login(u, p);
			},

			logout: async () => {
				await apiLogout().catch(() => {});

				disconnectWS();
				useChannelStore.getState().resetChannels();
				clearDesktopToken();

				set({ user: null, relationships: [], incomingRequests: [] });
			},

			fetchRelationships: async () => {
				try {
					const rels = await apiGetMyRelationships();
					set({ relationships: rels });
				} catch (e) {
					console.error('Failed to fetch relationships', e);
				}
			},

			fetchIncomingRequests: async () => {
				try {
					const reqs = await apiGetIncomingRequests();
					set({ incomingRequests: reqs });
				} catch (e) {
					console.error('Failed to fetch incoming requests', e);
				}
			},

			relationshipAction: async (userId: string, action: RelationshipAction) => {
				const res = await apiRelationshipAction(userId, action);
				await Promise.all([get().fetchRelationships(), get().fetchIncomingRequests()]);
				return res;
			},

			updateUser: async (data) => {
				const fresh = await apiUpdateProfile(data);
				set((state) => {
					if (!state.user) return { user: fresh };
					const updated = {
						...state.user,
						...fresh,
					};
					if ('avatar_id' in data) {
						updated.avatar_id = data.avatar_id ?? '';
					}
					if ('avatar_ids' in data) {
						updated.avatar_ids = data.avatar_ids ?? [];
					}
					return { user: updated };
				});

				// Keep every already-loaded channel's member_avatars snapshot for this
				// user in sync, so the deterministic fallback shows immediately in chat
				// bubbles, DM headers, sidebars, etc. instead of only after a reload.
				if ('avatar_id' in data) {
					const userId = get().user?.id;
					if (userId) {
						useChannelStore.getState().updateMemberAvatar(userId, data.avatar_id ?? '');
					}
				}
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
				set({ user: null, relationships: [], incomingRequests: [] });
			},
		}),
		{
			name: 'auth',
			partialize: (s) => ({
				user: s.user ? { ...s.user, token: undefined } : null,
			}),
		},
	),
);

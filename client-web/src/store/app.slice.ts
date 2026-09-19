import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiGetVersion } from '@/api/client';

export interface AppSlice {
	appVersion: string;
	wsState: 'connecting' | 'connected' | 'disconnected';
	theme: 'dark' | 'light';
	chatBackground: 'none' | 'animals' | 'space' | 'games' | 'sweets';

	isLeftSidebarOpen: boolean;
	isRightSidebarOpen: boolean;

	// Notification Settings
	enableDesktopNotifications: boolean;
	enableNotificationSounds: boolean;

	// Voice Settings
	preferredMicId: string;
	setPreferredMicId: (id: string) => void;

	fetchVersion: () => Promise<void>;
	setWsState: (s: AppSlice['wsState']) => void;
	setTheme: (theme: 'dark' | 'light') => void;
	setChatBackground: (bg: AppSlice['chatBackground']) => void;
	setLeftSidebarOpen: (open: boolean) => void;
	setRightSidebarOpen: (open: boolean) => void;
	setEnableDesktopNotifications: (enabled: boolean) => void;
	setEnableNotificationSounds: (enabled: boolean) => void;
}

export const useAppStore = create<AppSlice>()(
	persist(
		(set) => ({
			appVersion: 'V...',
			wsState: 'disconnected',
			theme: 'dark',
			chatBackground: 'none',
			isLeftSidebarOpen: false,
			isRightSidebarOpen: false,
			enableDesktopNotifications: true,
			enableNotificationSounds: true,
			preferredMicId: 'default',

			setWsState: (wsState) => set({ wsState }),
			setTheme: (theme) => set({ theme }),
			setChatBackground: (chatBackground) => set({ chatBackground }),
			setLeftSidebarOpen: (isLeftSidebarOpen) => set({ isLeftSidebarOpen }),
			setRightSidebarOpen: (isRightSidebarOpen) => set({ isRightSidebarOpen }),
			setEnableDesktopNotifications: (enableDesktopNotifications) =>
				set({ enableDesktopNotifications }),
			setEnableNotificationSounds: (enableNotificationSounds) =>
				set({ enableNotificationSounds }),
			setPreferredMicId: (preferredMicId) => set({ preferredMicId }),

			fetchVersion: async () => {
				try {
					const res = await apiGetVersion();
					set({ appVersion: res.version });
				} catch {
					console.error('Failed to fetch version');
				}
			},
		}),
		{
			name: 'app-settings',
			partialize: (s) => ({
				theme: s.theme,
				chatBackground: s.chatBackground,
				enableDesktopNotifications: s.enableDesktopNotifications,
				enableNotificationSounds: s.enableNotificationSounds,
				preferredMicId: s.preferredMicId,
			}),
			onRehydrateStorage: () => (state) => {
				const validPatterns = ['none', 'animals', 'space', 'games', 'sweets'];
				if (state && (!state.chatBackground || !validPatterns.includes(state.chatBackground))) {
					state.chatBackground = 'none';
				}
			},
		},
	),
);

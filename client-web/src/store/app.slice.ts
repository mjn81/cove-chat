import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiGetVersion } from '@/api/client';
import type { ThemeDefinition, ThemeMode } from '@/domains/themes/types/themes.types';
import type { ChatBackgroundChoice } from '@/domains/themes/utils/chat-backgrounds';
import { DEFAULT_THEME_ID, isBuiltinThemeId } from '@/domains/themes/data/builtin-themes';
import { resolveTheme } from '@/domains/themes/utils/resolve-theme';
import {
	backgroundAfterThemeChange,
	definitionFor,
	normalizeThemeSettings,
} from '@/domains/themes/utils/theme-settings';

export type SidebarTab = 'all' | 'dms' | 'channels';

export interface AppSlice {
	appVersion: string;
	wsState: 'connecting' | 'connected' | 'disconnected';
	/**
	 * The appearance actually on screen. Derived from `mode` and the selected theme (a dark-only theme stays dark in
	 * light mode), never set directly; read it wherever "is it dark?" matters.
	 */
	theme: ThemeMode;
	/** The user's light/dark preference. */
	mode: ThemeMode;
	/** Selected theme id: a built-in, or the id of `customTheme`. */
	themeId: string;
	/** Snapshot of the selected installed theme (null for built-ins); see `ThemeSettings.customTheme`. */
	customTheme: ThemeDefinition | null;
	chatBackground: ChatBackgroundChoice;

	isLeftSidebarOpen: boolean;
	isRightSidebarOpen: boolean;
	sidebarTab: SidebarTab;

	// Notification Settings
	enableDesktopNotifications: boolean;
	enableNotificationSounds: boolean;

	// Voice Settings
	preferredMicId: string;
	setPreferredMicId: (id: string) => void;

	fetchVersion: () => Promise<void>;
	setWsState: (s: AppSlice['wsState']) => void;
	/** Sets the light/dark preference. */
	setMode: (mode: ThemeMode) => void;
	/** Selects a theme (built-in, or an installed one whose validated definition is passed in). */
	selectTheme: (theme: ThemeDefinition) => void;
	/** Back to the Cove theme and no chat background; the light/dark preference is kept. */
	resetTheme: () => void;
	setChatBackground: (bg: ChatBackgroundChoice) => void;
	setLeftSidebarOpen: (open: boolean) => void;
	setRightSidebarOpen: (open: boolean) => void;
	setSidebarTab: (tab: SidebarTab) => void;
	setEnableDesktopNotifications: (enabled: boolean) => void;
	setEnableNotificationSounds: (enabled: boolean) => void;
}

/** The on-screen mode for a selection; the single derivation behind `AppSlice.theme`. */
function effectiveMode(mode: ThemeMode, themeId: string, customTheme: ThemeDefinition | null): ThemeMode {
	return resolveTheme(definitionFor(themeId, customTheme), mode).mode;
}

export const useAppStore = create<AppSlice>()(
	persist(
		(set, get) => ({
			appVersion: 'V...',
			wsState: 'disconnected',
			theme: 'dark',
			mode: 'dark',
			themeId: 'cove',
			customTheme: null,
			chatBackground: 'none',
			isLeftSidebarOpen: false,
			isRightSidebarOpen: false,
			sidebarTab: 'all',
			enableDesktopNotifications: true,
			enableNotificationSounds: true,
			preferredMicId: 'default',

			setWsState: (wsState) => set({ wsState }),
			setMode: (mode) => {
				const { themeId, customTheme } = get();
				set({ mode, theme: effectiveMode(mode, themeId, customTheme) });
			},
			selectTheme: (def) => {
				const { mode, chatBackground } = get();
				const customTheme = isBuiltinThemeId(def.id) ? null : def;
				set({
					themeId: def.id,
					customTheme,
					theme: effectiveMode(mode, def.id, customTheme),
					chatBackground: backgroundAfterThemeChange(chatBackground, def),
				});
			},
			resetTheme: () => {
				const { mode } = get();
				set({ themeId: DEFAULT_THEME_ID, customTheme: null, theme: effectiveMode(mode, DEFAULT_THEME_ID, null), chatBackground: 'none' });
			},
			setChatBackground: (chatBackground) => set({ chatBackground }),
			setLeftSidebarOpen: (isLeftSidebarOpen) => set({ isLeftSidebarOpen }),
			setRightSidebarOpen: (isRightSidebarOpen) => set({ isRightSidebarOpen }),
			setSidebarTab: (sidebarTab) => set({ sidebarTab }),
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
			// v1: `theme: 'dark' | 'light'` became `mode` plus a selected `themeId` (see `normalizeThemeSettings`).
			version: 1,
			migrate: (persisted) => ({ ...(persisted as object), ...normalizeThemeSettings(persisted) }),
			partialize: (s) => ({
				mode: s.mode,
				themeId: s.themeId,
				customTheme: s.customTheme,
				chatBackground: s.chatBackground,
				enableDesktopNotifications: s.enableDesktopNotifications,
				enableNotificationSounds: s.enableNotificationSounds,
				preferredMicId: s.preferredMicId,
			}),
			// Every load goes through the same validation, so edited or stale storage cannot inject an invalid theme.
			merge: (persisted, current) => {
				const themeSettings = normalizeThemeSettings(persisted);
				return {
					...current,
					...(persisted as object),
					...themeSettings,
					theme: effectiveMode(themeSettings.mode, themeSettings.themeId, themeSettings.customTheme),
				};
			},
		},
	),
);

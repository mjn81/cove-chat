import { useEffect, useState } from 'react';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import LeftSidebar from '@/components/Layout/LeftSidebar';
import RightSidebar from '@/components/Layout/RightSidebar';
import ChatArea from '@/components/ChatArea';
import { ChatBackgroundPattern } from '@/components/Chat/ChatBackgroundPattern';

import { useAppStore, useChannelStore } from '@/store/store';
import { onWS } from '@/ws';
import { ensureZstdReady } from '@/utils/file';
import { requestNotificationPermission } from '@/utils/notifications';
import { apiJoinChannel } from '@/api/client';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { VoiceChatController } from '@/components/Voice/VoiceChatController';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConnectionBanner } from '@/components/ConnectionBanner';

export default function AppPage() {
	const activeChannel = useChannelStore((state) => state.activeChannel);
	const refreshChannels = useChannelStore((state) => state.refreshChannels);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);

	const isMobile = useMediaQuery('(max-width: 768px)');
	const {
		isRightSidebarOpen,
		setLeftSidebarOpen,
		setRightSidebarOpen,
	} = useAppStore();

	useEffect(() => {
		const path = window.location.pathname;
		if (path.startsWith('/join/')) {
			const code = path.split('/join/')[1];
			if (code) {
				const autoJoin = async () => {
					try {
						const res = await apiJoinChannel(code);
						await refreshChannels();
						window.history.replaceState({}, '', '/');
						const allChannels = useChannelStore.getState().channels;
						const ch = allChannels.find((c) => c.id === res.id);
						if (ch) setActiveChannel(ch);
					} catch (err) {
						console.error('Auto-join failed:', err);
						window.history.replaceState({}, '', '/');
					}
				};
				autoJoin();
			}
		}
	}, []);

	useEffect(() => {
		ensureZstdReady();
		requestNotificationPermission();

		const unsubChannel = onWS('channel_update', () => {
			refreshChannels();
		});

		return () => {
			unsubChannel();
		};
	}, [refreshChannels]);

	const [isRightCollapsed, setIsRightCollapsed] = useState(true);

	// Close sidebars when active channel changes on mobile
	useEffect(() => {
		if (isMobile) {
			setLeftSidebarOpen(false);
			setRightSidebarOpen(false);
		}
	}, [activeChannel?.id, isMobile]);

	const renderLeftSidebar = () => (
		<div className="flex flex-col h-full overflow-hidden bg-secondary">
			<LeftSidebar />
		</div>
	);

	const renderRightSidebar = () => (
		<div className="flex flex-col h-full overflow-hidden bg-secondary">
			<RightSidebar isCollapsed={isMobile ? false : isRightCollapsed} />
		</div>
	);

	const renderChatArea = () => (
		<div className="flex flex-col flex-1 bg-background relative overflow-hidden">
			{activeChannel ? (
				<ChatArea channel={activeChannel} />
			) : (
				<>
					<ChatBackgroundPattern />
					<div className="flex flex-col flex-1" />
				</>
			)}
		</div>
	);

	if (isMobile) {
		return (
			<div className="h-screen w-full bg-background flex flex-col overflow-hidden relative">
				<ConnectionBanner />
				{/* Mobile App Navigation Logic */}
				{!activeChannel ? (
					// Mode 1: Chat Selector (Main Page)
					<div className="flex-1 flex flex-col overflow-hidden animate-in fade-in slide-in-from-left-4 duration-300">
						{renderLeftSidebar()}
					</div>
				) : (
					// Mode 2: Dedicated Chat View
					<div className="flex-1 flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
						{renderChatArea()}
					</div>
				)}

				{/* Right Sidebar Drawer (Members) - Only accessible from Chat View */}
				<div
					className={`fixed inset-y-0 right-0 w-full sm:w-[320px] z-50 transform transition-transform duration-300 ease-in-out shadow-2xl ${
						isRightSidebarOpen && activeChannel ? 'translate-x-0' : 'translate-x-full'
					}`}
				>
					{renderRightSidebar()}
				</div>

				{/* Overlay for Right Sidebar on Tablets/Small Desktop but we use isMobile here */}
				{isRightSidebarOpen && activeChannel && isMobile && (
					<div
						className="fixed inset-0 bg-black/60 z-40 backdrop-blur-[2px] transition-opacity duration-300 animate-in fade-in"
						onClick={() => setRightSidebarOpen(false)}
					/>
				)}

				<ErrorBoundary label="voice chat">
					<VoiceChatController />
				</ErrorBoundary>
			</div>
		);
	}

	return (
		<div className="h-screen w-full flex flex-col overflow-hidden">
		<ConnectionBanner />
		<ResizablePanelGroup
			direction="horizontal"
			className="flex-1 w-full bg-background overflow-hidden"
		>
			<ResizablePanel
				defaultSize="280px"
				minSize="240px"
				maxSize="500px"
				groupResizeBehavior="preserve-pixel-size"
				className="bg-secondary flex flex-col overflow-hidden"
			>
				{renderLeftSidebar()}
			</ResizablePanel>

			<ResizableHandle withHandle className="bg-border" />

			<ResizablePanel
				minSize="40%"
				groupResizeBehavior="preserve-relative-size"
				className="flex flex-col bg-background relative"
			>
				{renderChatArea()}
			</ResizablePanel>

			<ResizableHandle withHandle className="bg-border" />

			<ResizablePanel
				defaultSize="64px"
				minSize="64px"
				maxSize="320px"
				collapsible={true}
				collapsedSize="64px"
				groupResizeBehavior="preserve-pixel-size"
				onResize={(panelSize) => setIsRightCollapsed(panelSize.inPixels <= 64)}
				className="bg-secondary flex flex-col transition-all duration-300 ease-in-out"
			>
				{renderRightSidebar()}
			</ResizablePanel>
		</ResizablePanelGroup>
		<ErrorBoundary label="voice chat">
			<VoiceChatController />
		</ErrorBoundary>
	</div>
	);
}

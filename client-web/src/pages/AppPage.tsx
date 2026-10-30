import { useEffect, useRef, useState } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import LeftSidebar from '@/domains/channels/components/left-sidebar';
import RightSidebar from '@/components/Layout/RightSidebar';
import { NavStrip } from '@/components/Layout/NavStrip';
import ChatArea from '@/components/ChatArea';
import { ChatBackgroundPattern } from '@/components/Chat/ChatBackgroundPattern';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

import { useAppStore, useChannelStore, initWhisperListeners } from '@/store/store';
import { onWS } from '@/ws';
import { ensureZstdReady } from '@/utils/file';
import { requestNotificationPermission } from '@/utils/notifications';
import { JoinPreview } from '@/components/Chat/JoinPreview';
import { ModalShell } from '@/components/modal-shell';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { VoiceChatController } from '@/components/Voice/VoiceChatController';
import { IncomingCallModal } from '@/components/Voice/IncomingCallModal';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { WhisperIncomingToast } from '@/components/WhisperIncomingToast';
import { WhisperStartModal } from '@/components/Chat/WhisperStartModal';
import { WhisperSafetyNumberModal } from '@/components/Chat/WhisperSafetyNumberModal';

export default function AppPage() {
	const activeChannel = useChannelStore((state) => state.activeChannel);
	const refreshChannels = useChannelStore((state) => state.refreshChannels);

	const { t } = useTranslation();
	const isMobile = useMediaQuery('(max-width: 768px)');
	const {
		isRightSidebarOpen,
		setLeftSidebarOpen,
		setRightSidebarOpen,
		sidebarTab,
		setSidebarTab,
	} = useAppStore();

	// An invite link in the URL opens a preview card; joining is always an explicit click.
	const [inviteCode, setInviteCode] = useState<string | null>(() => {
		const match = window.location.pathname.match(/^\/join\/([^/]+)/);
		return match ? match[1] : null;
	});

	const closeInvite = () => {
		window.history.replaceState({}, '', '/');
		setInviteCode(null);
	};

	useEffect(() => {
		ensureZstdReady();
		requestNotificationPermission();
		initWhisperListeners();

		const unsubChannel = onWS('channel_update', () => {
			refreshChannels();
		});

		return () => {
			unsubChannel();
		};
	}, [refreshChannels]);

	const [isRightCollapsed, setIsRightCollapsed] = useState(true);
	const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
	const [isLeftTransitioning, setIsLeftTransitioning] = useState(false);
	const [isRightTransitioning, setIsRightTransitioning] = useState(false);
	const leftPanelRef = useRef<PanelImperativeHandle | null>(null);
	const rightPanelRef = useRef<PanelImperativeHandle | null>(null);

	// Close sidebars when active channel changes on mobile
	useEffect(() => {
		if (isMobile) {
			setLeftSidebarOpen(false);
			setRightSidebarOpen(false);
		}
	}, [activeChannel?.id, isMobile, setLeftSidebarOpen, setRightSidebarOpen]);

	const toggleLeftCollapse = () => {
		const panel = leftPanelRef.current;
		if (!panel) return;
		setIsLeftTransitioning(true);
		setTimeout(() => setIsLeftTransitioning(false), 310);
		if (isLeftCollapsed) {
			panel.expand();
			if (panel.getSize().inPixels <= 70) {
				panel.resize(280);
			}
		} else {
			panel.collapse();
		}
	};

	const toggleRightCollapse = () => {
		const panel = rightPanelRef.current;
		if (!panel) return;
		setIsRightTransitioning(true);
		setTimeout(() => setIsRightTransitioning(false), 310);
		if (isRightCollapsed) {
			panel.expand();
			if (panel.getSize().inPixels <= 70) {
				panel.resize(260);
			}
		} else {
			panel.collapse();
		}
	};

	const renderLeftSidebar = () => (
		<div className="flex flex-col h-full overflow-hidden bg-popover">
			<LeftSidebar
				isCollapsed={isMobile ? false : isLeftCollapsed}
				onToggleCollapse={isMobile ? undefined : toggleLeftCollapse}
			/>
		</div>
	);

	const renderRightSidebar = () => (
		<div className="flex flex-col h-full overflow-hidden bg-popover">
			<RightSidebar
				isCollapsed={isMobile ? false : isRightCollapsed}
				onToggleCollapse={isMobile ? undefined : toggleRightCollapse}
			/>
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

	return (
		<div className="h-screen w-full bg-background flex flex-col overflow-hidden relative">
			<ConnectionBanner />
			{isMobile ? (
				<>
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
						className={`fixed bottom-0 top-[var(--titlebar-h,0px)] end-0 w-full sm:w-[320px] z-50 transform transition-transform duration-300 ease-in-out shadow-2xl ${
							isRightSidebarOpen && activeChannel ? 'translate-x-0' : 'translate-x-full'
						}`}
					>
						{renderRightSidebar()}
					</div>

					{/* Overlay for Right Sidebar on Tablets/Small Desktop */}
					{isRightSidebarOpen && activeChannel && (
						<div
							className="fixed inset-x-0 bottom-0 top-[var(--titlebar-h,0px)] bg-black/60 z-40 backdrop-blur-[2px] transition-opacity duration-300 animate-in fade-in"
							onClick={() => setRightSidebarOpen(false)}
						/>
					)}
				</>
			) : (
				<div className="flex-1 w-full flex flex-row overflow-hidden">
					<NavStrip
						activeTab={sidebarTab}
						onChange={setSidebarTab}
						orientation="vertical"
					/>
					<ResizablePanelGroup
						direction="horizontal"
						className="flex-1 w-full bg-background overflow-hidden"
					>
						<ResizablePanel
							panelRef={leftPanelRef}
							defaultSize="280px"
							minSize="240px"
							maxSize="500px"
							collapsible={true}
							collapsedSize="64px"
							groupResizeBehavior="preserve-pixel-size"
							onResize={(panelSize) => setIsLeftCollapsed(panelSize.inPixels <= 70)}
							className={cn(
								'bg-popover flex flex-col overflow-hidden',
								isLeftTransitioning && 'transition-all duration-300 ease-in-out',
							)}
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
							panelRef={rightPanelRef}
							defaultSize="64px"
							minSize="220px"
							maxSize="320px"
							collapsible={true}
							collapsedSize="64px"
							groupResizeBehavior="preserve-pixel-size"
							onResize={(panelSize) => setIsRightCollapsed(panelSize.inPixels <= 70)}
							className={cn(
								'bg-popover flex flex-col',
								isRightTransitioning && 'transition-all duration-300 ease-in-out',
							)}
						>
							{renderRightSidebar()}
						</ResizablePanel>
					</ResizablePanelGroup>
				</div>
			)}
			<ErrorBoundary label="voice chat">
				<VoiceChatController />
			</ErrorBoundary>
			<IncomingCallModal />
			<WhisperIncomingToast />
			<WhisperStartModal />
			<WhisperSafetyNumberModal />
			<ModalShell
				size="sm"
				open={!!inviteCode}
				onOpenChange={(open) => !open && closeInvite()}
				title={t('channel.invite.preview.title')}
			>
				{inviteCode && <JoinPreview inviteCode={inviteCode} onDone={closeInvite} />}
			</ModalShell>
		</div>
	);
}

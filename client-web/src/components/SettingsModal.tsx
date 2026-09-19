import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogDescription,
} from '@/components/ui/dialog';
import { X, ChevronLeft } from 'lucide-react';
import { useAuthStore } from '@/store/store';
import { Sidebar } from './SettingsModal/Sidebar';
import { AccountTab } from './SettingsModal/AccountTab';
import { FriendsTab } from './SettingsModal/FriendsTab';
import { AppearanceTab } from './SettingsModal/AppearanceTab';
import { PrivacyTab } from './SettingsModal/PrivacyTab';
import { NotificationsTab } from './SettingsModal/NotificationsTab';
import { VoiceTab } from './SettingsModal/VoiceTab';
import { StorageTab } from './SettingsModal/StorageTab';
import type { SettingsTab } from './SettingsModal/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface SettingsModalProps {
	onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
	const { t } = useTranslation();
	const user = useAuthStore((state) => state.user);
	const [activeTab, setActiveTab] = useState<SettingsTab>('account');
	const [isViewingContent, setIsViewingContent] = useState(false);
	const isMobile = useMediaQuery('(max-width: 768px)');

	if (!user) return null;

	const handleTabChange = (tab: SettingsTab) => {
		setActiveTab(tab);
		if (isMobile) setIsViewingContent(true);
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				className={`bg-background border-none text-foreground flex flex-col p-0 overflow-hidden shadow-2xl [&>button]:hidden ${
					isMobile
						? 'w-full h-full max-w-none rounded-none'
						: 'max-w-[960px] md:max-w-[1000px] h-[640px] md:h-[680px] rounded-xl'
				}`}
			>
				<DialogTitle className="sr-only">{t('settings.title')}</DialogTitle>
				<DialogDescription className="sr-only">
					{t('settings.delete_description')}
				</DialogDescription>

				<div className="flex h-full relative">
					{(!isMobile || !isViewingContent) && (
						<div className={`relative ${isMobile ? 'w-full' : 'w-[220px]'}`}>
							<Sidebar
								activeTab={activeTab}
								setActiveTab={handleTabChange}
								isMobile={isMobile}
							/>
							{/* Mobile Top Close Button (Menu mode) */}
							{isMobile && !isViewingContent && (
								<button
									onClick={onClose}
									className="absolute top-4 right-4 p-2 bg-background/50 rounded-full text-foreground pt-safe"
								>
									<X size={20} />
								</button>
							)}
						</div>
					)}

					{(!isMobile || isViewingContent) && (
						<div className="flex-1 flex flex-col bg-background relative animate-in slide-in-from-right-4 duration-200">
							{isMobile && (
								<div className="flex items-center gap-2 p-2 border-b border-border bg-secondary/30 pt-safe">
									<button
										onClick={() => setIsViewingContent(false)}
										className="p-1 hover:bg-accent rounded-full transition-colors"
									>
										<ChevronLeft size={24} />
									</button>
									<span className="font-bold uppercase text-xs tracking-wider text-muted-foreground">
										{activeTab === 'account' && t('settings.my_account')}
										{activeTab === 'privacy' && t('settings.privacy')}
										{activeTab === 'appearance' && t('settings.appearance')}
										{activeTab === 'notifications' &&
											t('settings.notifications')}
										{activeTab === 'voice' && t('settings.voice_video')}
										{activeTab === 'storage' && t('settings.storage')}
									</span>
								</div>
							)}

							<div
								className={`flex-1 overflow-y-auto custom-scrollbar pb-20 ${
									isMobile ? 'p-6' : 'p-10 pt-12'
								}`}
							>
								{activeTab === 'account' && <AccountTab />}
								{activeTab === 'friends' && <FriendsTab onCloseModal={onClose} />}
								{activeTab === 'appearance' && <AppearanceTab />}
								{activeTab === 'privacy' && <PrivacyTab />}
								{activeTab === 'notifications' && <NotificationsTab />}
								{activeTab === 'voice' && <VoiceTab />}
								{activeTab === 'storage' && <StorageTab />}
							</div>

							{/* Floating Close Button - Desktop Only */}
							{!isMobile && (
								<div className="absolute top-6 right-6">
									<button
										onClick={onClose}
										className="group flex flex-col items-center gap-1"
									>
										<div className="w-9 h-9 rounded-full border-2 border-muted-foreground group-hover:border-foreground flex items-center justify-center transition-all">
											<X
												className="text-muted-foreground group-hover:text-foreground"
												size={20}
											/>
										</div>
										<span className="text-xs font-bold text-muted-foreground group-hover:text-foreground uppercase tracking-tighter">
											Esc
										</span>
									</button>
								</div>
							)}
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

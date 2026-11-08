import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { ChatBackgroundPicker } from '@/domains/themes/components/chat-background-picker';
import { ThemesSection } from '@/domains/themes/components/themes-section';

export const AppearanceTab = () => {
	const { t, i18n } = useTranslation();

	const changeLanguage = (lng: string) => {
		i18n.changeLanguage(lng);
	};

	return (
		<div className="w-full max-w-[500px] mx-auto animate-in fade-in slide-in-from-right-4 duration-300">
			<h2 className="text-xl font-bold text-foreground mb-5">
				{t('settings.appearance')}
			</h2>

			<div className="space-y-8">
				<ThemesSection />

				{/* Chat Background Section */}
				<section>
					<h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
						{t('settings.chat_background')}
					</h3>
					<ChatBackgroundPicker />
					<p className="text-[11px] text-muted-foreground mt-2">{t('settings.chat_bg_hint')}</p>
				</section>

				{/* Language Section */}
				<section>
					<h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
						{t('settings.language')}
					</h3>
					<div className="space-y-1 bg-secondary/50 rounded-md overflow-hidden p-1 shadow-inner border border-border/50">
						{[
							{ id: 'en', name: 'English', local: 'English' },
							{ id: 'fa', name: 'Persian', local: 'فارسی' },
							{ id: 'ar', name: 'Arabic', local: 'العربية' },
						].map((lang) => (
							<button
								key={lang.id}
								onClick={() => changeLanguage(lang.id)}
								className={`w-full flex items-center justify-between px-3 py-2 rounded transition-colors text-sm font-medium cursor-pointer select-none ${
									i18n.language.startsWith(lang.id)
										? 'bg-accent text-accent-foreground'
										: 'text-foreground hover:bg-accent/50'
								}`}
							>
								<div className="flex flex-col items-start leading-tight select-none pointer-events-none">
									<span className="select-none pointer-events-none">{lang.name}</span>
									<span className="text-[11px] opacity-60 select-none pointer-events-none">
										{lang.local}
									</span>
								</div>
								{i18n.language.startsWith(lang.id) && (
									<Check size={16} className="text-primary pointer-events-none" />
								)}
							</button>
						))}
					</div>
				</section>
			</div>
		</div>
	);
};


import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { useAppStore } from '@/store/store';

import animalsSvg from '@/assets/patterns/animals.svg?url';
import spaceSvg from '@/assets/patterns/space.svg?url';
import gamesSvg from '@/assets/patterns/games.svg?url';
import sweetsSvg from '@/assets/patterns/sweets.svg?url';

const CHAT_BACKGROUND_OPTIONS = [
	{ id: 'none', label: 'None' },
	{ id: 'animals', label: 'Animals', src: animalsSvg },
	{ id: 'space', label: 'Space', src: spaceSvg },
	{ id: 'games', label: 'Games', src: gamesSvg },
	{ id: 'sweets', label: 'Sweets', src: sweetsSvg },
] as const;

export const AppearanceTab = () => {
	const { t, i18n } = useTranslation();
	const theme = useAppStore((state) => state.theme);
	const setTheme = useAppStore((state) => state.setTheme);
	const chatBackground = useAppStore((state) => state.chatBackground);
	const setChatBackground = useAppStore((state) => state.setChatBackground);

	const changeLanguage = (lng: string) => {
		i18n.changeLanguage(lng);
	};

	return (
		<div className="w-full max-w-[500px] mx-auto animate-in fade-in slide-in-from-right-4 duration-300">
			<h2 className="text-xl font-bold text-foreground mb-5">
				{t('settings.appearance')}
			</h2>

			<div className="space-y-8">
				{/* Theme Section */}
				<section>
					<h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
						{t('settings.theme')}
					</h3>
					<div className="grid grid-cols-2 gap-3">
						<button
							onClick={() => setTheme('dark')}
							className={`flex flex-col gap-2 p-3 rounded-lg border-2 transition-all cursor-pointer select-none ${
								theme === 'dark'
									? 'border-primary bg-secondary'
									: 'border-transparent bg-secondary hover:bg-secondary/80'
							}`}
						>
							<div className="dark h-12 w-full bg-popover rounded flex items-center justify-center overflow-hidden relative">
								<div className="absolute top-2 start-2 w-4 h-4 bg-card rounded-full" />
								<div className="flex flex-col gap-1 w-full px-8">
									<div className="h-1.5 w-full bg-accent rounded-full" />
									<div className="h-1.5 w-2/3 bg-accent rounded-full" />
								</div>
								{theme === 'dark' && (
									<div className="absolute bottom-2 end-2 bg-primary rounded-full p-0.5">
										<Check size={12} className="text-white" />
									</div>
								)}
							</div>
							<span
								className={`text-sm font-bold text-center ${theme === 'dark' ? 'text-foreground' : 'text-muted-foreground'}`}
							>
								{t('settings.dark')}
							</span>
						</button>
						<button
							onClick={() => setTheme('light')}
							className={`flex flex-col gap-2 p-3 rounded-lg border-2 transition-all cursor-pointer select-none ${
								theme === 'light'
									? 'border-primary bg-white shadow-md'
									: 'border-transparent bg-secondary hover:bg-secondary/80'
							}`}
						>
							<div className="light h-12 w-full bg-card rounded flex items-center justify-center overflow-hidden relative">
								<div className="absolute top-2 start-2 w-4 h-4 bg-background rounded-full border border-border" />
								<div className="flex flex-col gap-1 w-full px-8">
									<div className="h-1.5 w-full bg-accent rounded-full" />
									<div className="h-1.5 w-2/3 bg-accent rounded-full" />
								</div>
								{theme === 'light' && (
									<div className="absolute bottom-2 end-2 bg-primary rounded-full p-0.5">
										<Check size={12} className="text-white" />
									</div>
								)}
							</div>
							<span
								className={`text-sm font-bold text-center ${theme === 'light' ? 'text-black' : 'text-muted-foreground'}`}
							>
								{t('settings.light')}
							</span>
						</button>
					</div>
				</section>

				{/* Chat Background Section */}
				<section>
					<h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
						{t('settings.chat_background')}
					</h3>
					<div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
						{CHAT_BACKGROUND_OPTIONS.map((opt) => {
							const isSelected = chatBackground === opt.id;
							const hasPattern = 'src' in opt && !!opt.src;
							return (
								<button
									key={opt.id}
									onClick={() => setChatBackground(opt.id)}
									className={`flex flex-col gap-1.5 p-2 rounded-lg border-2 transition-all cursor-pointer select-none ${
										isSelected
											? 'border-primary bg-secondary shadow-sm'
											: 'border-transparent bg-secondary hover:bg-secondary/80'
									}`}
								>
									<div className="h-12 w-full bg-background rounded flex items-center justify-center overflow-hidden relative border border-border/50">
										{hasPattern ? (
											<div
												className="absolute inset-0 pointer-events-none"
												style={{
													maskImage: `url(${opt.src})`,
													WebkitMaskImage: `url(${opt.src})`,
													maskSize: '90px 185px',
													WebkitMaskSize: '90px 185px',
													maskRepeat: 'repeat',
													WebkitMaskRepeat: 'repeat',
													backgroundColor:
														theme === 'dark'
															? 'hsl(var(--foreground) / 0.15)'
															: 'hsl(var(--foreground) / 0.12)',
												}}
											/>
										) : (
											<span className="text-xs text-muted-foreground/60 font-semibold select-none">
												None
											</span>
										)}
										{isSelected && (
											<div className="absolute bottom-1 end-1 bg-primary rounded-full p-0.5 z-10 shadow-sm">
												<Check size={10} className="text-white" />
											</div>
										)}
									</div>
									<span
										className={`text-xs font-medium text-center truncate w-full ${isSelected ? 'text-foreground font-bold' : 'text-muted-foreground'}`}
									>
										{opt.label}
									</span>
								</button>
							);
						})}
					</div>
					<p className="text-[11px] text-muted-foreground mt-2">
						Vector doodle wallpapers inspired by Telegram messenger design.
					</p>
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

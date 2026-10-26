import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
	HardDrive,
	ImageIcon,
	Film,
	Mic,
	FileText,
	MessageSquare,
	Trash2,
	Loader2,
	RefreshCw,
} from 'lucide-react';
import { storageService, type StorageStats, type StorageCategory } from '@/lib/db';
import { ConfirmModal } from '../ConfirmModal';

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const StorageTab = () => {
	const { t } = useTranslation();
	const [stats, setStats] = useState<StorageStats | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [clearingCategory, setClearingCategory] = useState<string | null>(null);
	const [showClearAllModal, setShowClearAllModal] = useState(false);

	const loadStats = async () => {
		try {
			const data = await storageService.getStorageStats();
			setStats(data);
		} catch (err) {
			console.error('Failed to get storage stats:', err);
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		loadStats();
	}, []);

	const handleClearCategory = async (category: StorageCategory) => {
		setClearingCategory(category);
		try {
			await storageService.clearCategory(category);
			await loadStats();
		} catch (err) {
			console.error(`Failed to clear category ${category}:`, err);
		} finally {
			setClearingCategory(null);
		}
	};

	const handleClearAll = async () => {
		setShowClearAllModal(false);
		setClearingCategory('all');
		try {
			await storageService.clearCategory('all');
			await loadStats();
		} catch (err) {
			console.error('Failed to clear all storage:', err);
		} finally {
			setClearingCategory(null);
		}
	};

	const totalBytes = stats?.totalBytes || 0;
	const getPercentage = (bytes: number) => {
		if (totalBytes === 0) return 0;
		return Math.max(2, Math.min(100, (bytes / totalBytes) * 100));
	};

	return (
		<div className="w-full max-w-[540px] mx-auto animate-in fade-in slide-in-from-right-4 duration-300 select-none pb-8">
			<div className="flex items-center justify-between mb-2">
				<h2 className="text-xl font-bold text-foreground">
					{t('settings.storage')}
				</h2>
				<button
					onClick={() => {
						setIsLoading(true);
						loadStats();
					}}
					disabled={isLoading}
					className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition cursor-pointer"
					title="Refresh"
				>
					<RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
				</button>
			</div>
			<p className="text-sm text-muted-foreground mb-6">
				{t('settings.storage_description')}
			</p>

			{/* Total Overview Card */}
			<div className="bg-secondary/60 border border-border/70 rounded-xl p-5 mb-6 shadow-sm">
				<div className="flex items-center justify-between mb-3">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
							<HardDrive size={22} />
						</div>
						<div>
							<div className="text-2xl font-bold text-foreground tracking-tight tabular-nums">
								{isLoading ? '...' : formatBytes(totalBytes)}
							</div>
							<div className="text-xs text-muted-foreground">
								{isLoading
									? 'Calculating...'
									: `${stats?.totalCount || 0} ${t('settings.cached_items')}`}
							</div>
						</div>
					</div>
					{totalBytes > 0 && (
						<button
							onClick={() => setShowClearAllModal(true)}
							disabled={clearingCategory !== null}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 transition cursor-pointer"
						>
							<Trash2 size={14} />
							{t('settings.clear_all_cache')}
						</button>
					)}
				</div>

				{/* Visual Storage Distribution Bar */}
				{totalBytes > 0 && stats && (
					<div className="w-full h-2 rounded-full overflow-hidden bg-background/50 flex gap-0.5 mt-4">
						{stats.images.bytes > 0 && (
							<div
								className="bg-primary h-full rounded-full transition-all duration-300"
								style={{ width: `${getPercentage(stats.images.bytes)}%` }}
								title={`Images: ${formatBytes(stats.images.bytes)}`}
							/>
						)}
						{stats.videos.bytes > 0 && (
							<div
								className="bg-primary h-full rounded-full transition-all duration-300"
								style={{ width: `${getPercentage(stats.videos.bytes)}%` }}
								title={`Videos: ${formatBytes(stats.videos.bytes)}`}
							/>
						)}
						{stats.voices.bytes > 0 && (
							<div
								className="bg-warning h-full rounded-full transition-all duration-300"
								style={{ width: `${getPercentage(stats.voices.bytes)}%` }}
								title={`Voice Notes: ${formatBytes(stats.voices.bytes)}`}
							/>
						)}
						{stats.otherFiles.bytes > 0 && (
							<div
								className="bg-success h-full rounded-full transition-all duration-300"
								style={{ width: `${getPercentage(stats.otherFiles.bytes)}%` }}
								title={`Files: ${formatBytes(stats.otherFiles.bytes)}`}
							/>
						)}
						{stats.messages.bytes > 0 && (
							<div
								className="bg-primary h-full rounded-full transition-all duration-300"
								style={{ width: `${getPercentage(stats.messages.bytes)}%` }}
								title={`Messages: ${formatBytes(stats.messages.bytes)}`}
							/>
						)}
					</div>
				)}
			</div>

			{/* Categories List */}
			<div className="space-y-2.5">
				<h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 px-1">
					{t('settings.categories')}
				</h3>

				{/* Images */}
				<div className="flex items-center justify-between p-3.5 bg-secondary/40 border border-border/50 rounded-lg hover:bg-secondary/60 transition">
					<div className="flex items-center gap-3">
						<div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
							<ImageIcon size={18} />
						</div>
						<div>
							<div className="text-sm font-medium text-foreground">
								{t('settings.cached_images')}
							</div>
							<div className="text-xs text-muted-foreground tabular-nums">
								{stats?.images.count || 0} files •{' '}
								{formatBytes(stats?.images.bytes || 0)}
							</div>
						</div>
					</div>
					<button
						onClick={() => handleClearCategory('images')}
						disabled={
							(stats?.images.count || 0) === 0 || clearingCategory !== null
						}
						className="px-2.5 py-1 text-xs font-semibold rounded-md border border-border bg-background hover:bg-accent text-foreground disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
					>
						{clearingCategory === 'images' ? (
							<Loader2 size={12} className="animate-spin" />
						) : (
							t('settings.clear')
						)}
					</button>
				</div>

				{/* Videos */}
				<div className="flex items-center justify-between p-3.5 bg-secondary/40 border border-border/50 rounded-lg hover:bg-secondary/60 transition">
					<div className="flex items-center gap-3">
						<div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
							<Film size={18} />
						</div>
						<div>
							<div className="text-sm font-medium text-foreground">
								{t('settings.cached_videos')}
							</div>
							<div className="text-xs text-muted-foreground tabular-nums">
								{stats?.videos.count || 0} files •{' '}
								{formatBytes(stats?.videos.bytes || 0)}
							</div>
						</div>
					</div>
					<button
						onClick={() => handleClearCategory('videos')}
						disabled={
							(stats?.videos.count || 0) === 0 || clearingCategory !== null
						}
						className="px-2.5 py-1 text-xs font-semibold rounded-md border border-border bg-background hover:bg-accent text-foreground disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
					>
						{clearingCategory === 'videos' ? (
							<Loader2 size={12} className="animate-spin" />
						) : (
							t('settings.clear')
						)}
					</button>
				</div>

				{/* Voice Notes */}
				<div className="flex items-center justify-between p-3.5 bg-secondary/40 border border-border/50 rounded-lg hover:bg-secondary/60 transition">
					<div className="flex items-center gap-3">
						<div className="w-8 h-8 rounded-md bg-warning/10 text-warning flex items-center justify-center">
							<Mic size={18} />
						</div>
						<div>
							<div className="text-sm font-medium text-foreground">
								{t('settings.cached_voices')}
							</div>
							<div className="text-xs text-muted-foreground tabular-nums">
								{stats?.voices.count || 0} voice notes •{' '}
								{formatBytes(stats?.voices.bytes || 0)}
							</div>
						</div>
					</div>
					<button
						onClick={() => handleClearCategory('voices')}
						disabled={
							(stats?.voices.count || 0) === 0 || clearingCategory !== null
						}
						className="px-2.5 py-1 text-xs font-semibold rounded-md border border-border bg-background hover:bg-accent text-foreground disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
					>
						{clearingCategory === 'voices' ? (
							<Loader2 size={12} className="animate-spin" />
						) : (
							t('settings.clear')
						)}
					</button>
				</div>

				{/* Other Files */}
				<div className="flex items-center justify-between p-3.5 bg-secondary/40 border border-border/50 rounded-lg hover:bg-secondary/60 transition">
					<div className="flex items-center gap-3">
						<div className="w-8 h-8 rounded-md bg-success/10 text-success flex items-center justify-center">
							<FileText size={18} />
						</div>
						<div>
							<div className="text-sm font-medium text-foreground">
								{t('settings.cached_files')}
							</div>
							<div className="text-xs text-muted-foreground tabular-nums">
								{stats?.otherFiles.count || 0} files •{' '}
								{formatBytes(stats?.otherFiles.bytes || 0)}
							</div>
						</div>
					</div>
					<button
						onClick={() => handleClearCategory('otherFiles')}
						disabled={
							(stats?.otherFiles.count || 0) === 0 || clearingCategory !== null
						}
						className="px-2.5 py-1 text-xs font-semibold rounded-md border border-border bg-background hover:bg-accent text-foreground disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
					>
						{clearingCategory === 'otherFiles' ? (
							<Loader2 size={12} className="animate-spin" />
						) : (
							t('settings.clear')
						)}
					</button>
				</div>

				{/* Messages */}
				<div className="flex items-center justify-between p-3.5 bg-secondary/40 border border-border/50 rounded-lg hover:bg-secondary/60 transition">
					<div className="flex items-center gap-3">
						<div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
							<MessageSquare size={18} />
						</div>
						<div>
							<div className="text-sm font-medium text-foreground">
								{t('settings.cached_messages')}
							</div>
							<div className="text-xs text-muted-foreground tabular-nums">
								{stats?.messages.count || 0} messages • ~
								{formatBytes(stats?.messages.bytes || 0)}
							</div>
						</div>
					</div>
					<button
						onClick={() => handleClearCategory('messages')}
						disabled={
							(stats?.messages.count || 0) === 0 || clearingCategory !== null
						}
						className="px-2.5 py-1 text-xs font-semibold rounded-md border border-border bg-background hover:bg-accent text-foreground disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
					>
						{clearingCategory === 'messages' ? (
							<Loader2 size={12} className="animate-spin" />
						) : (
							t('settings.clear')
						)}
					</button>
				</div>
			</div>

			<ConfirmModal
				isOpen={showClearAllModal}
				onClose={() => setShowClearAllModal(false)}
				onConfirm={handleClearAll}
				title={t('settings.clear_all_cache')}
				message="Are you sure you want to clear all locally cached media and messages? Files will be re-downloaded from the server when opened."
				confirmText={t('settings.clear_all_cache')}
				variant="danger"
			/>
		</div>
	);
};

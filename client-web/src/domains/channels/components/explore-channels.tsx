import { useTranslation } from 'react-i18next';
import { Hash } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ExploreChannel } from '@/types/api';

interface ExploreChannelsProps {
	/** Public channels the user has not joined. */
	channels: ExploreChannel[];
	isLoading: boolean;
	/** Id of the channel currently being joined, if any. */
	joiningId: string | null;
	onJoin: (inviteLink: string, id: string) => void;
}

/** "Public channels" section shown under the list while the user is searching. */
export const ExploreChannels = ({ channels, isLoading, joiningId, onJoin }: ExploreChannelsProps) => {
	const { t } = useTranslation();

	return (
		<div className="mt-6">
			<div className="mb-[2px] flex items-center justify-between px-4">
				<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					{t('sidebar.public_channels')}
				</span>
			</div>
			{isLoading ? (
				<div className="flex justify-center py-4">
					<span className="spinner" />
				</div>
			) : channels.length > 0 ? (
				<div className="mt-2 flex flex-col gap-0.5">
					{channels.map((ch) => (
						<div
							key={ch.id}
							onClick={() => onJoin(ch.invite_link, ch.id)}
							className={cn(
								'mx-2 flex min-w-0 cursor-pointer select-none items-center justify-between overflow-hidden rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground',
							)}
						>
							<div className="pointer-events-none me-2 flex min-w-0 flex-1 select-none items-center gap-3">
								<Hash className="h-5 w-5 shrink-0 opacity-70" />
								<span className="min-w-0 flex-1 truncate text-[15px] font-medium leading-none">
									{ch.name}
								</span>
							</div>
							{joiningId === ch.id ? (
								<span className="spinner small" />
							) : (
								<span className="pointer-events-none text-xs font-semibold text-primary">
									{t('sidebar.join')}
								</span>
							)}
						</div>
					))}
				</div>
			) : (
				<div className="mt-2 px-4 text-center text-xs text-muted-foreground">
					{t('sidebar.no_public_channels')}
				</div>
			)}
		</div>
	);
};

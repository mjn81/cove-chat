import React from 'react';
import { FileIcon, Loader2, Download } from 'lucide-react';

interface GenericFileBubbleProps {
	meta: any;
	isDecrypting: boolean;
	progress: number;
	handleDownload: () => void;
}

export const GenericFileBubble: React.FC<GenericFileBubbleProps> = ({
	meta,
	isDecrypting,
	progress,
	handleDownload,
}) => {
	return (
		<div
			className="relative flex items-center gap-4 bg-secondary border border-border rounded-md p-3 w-full hover:bg-accent transition cursor-pointer group overflow-hidden"
			onClick={() => handleDownload()}
		>
			<div className="w-10 h-10 bg-background rounded flex items-center justify-center text-muted-foreground shrink-0">
				{isDecrypting ? (
					<Loader2 size={20} className="animate-spin text-primary" />
				) : (
					<FileIcon size={20} />
				)}
			</div>
			<div className="flex flex-col min-w-0 flex-1">
				<span className="text-[14px] text-foreground font-medium truncate">
					{meta.name || 'Encrypted File'}
				</span>
				<span className="text-xs text-muted-foreground">
					{(meta.size / 1024).toFixed(1)} KB •{' '}
					{meta.mime.split('/')[1]?.toUpperCase() || 'FILE'}
				</span>
			</div>
			<button className="text-muted-foreground hover:text-foreground transition p-1 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all duration-200">
				<Download size={20} />
			</button>

			{isDecrypting && (
				<div className="absolute bottom-0 start-0 end-0 h-0.5 bg-primary/20 rounded-b-md">
					<div
						className="h-full bg-primary transition-all"
						style={{ width: `${progress}%` }}
					/>
				</div>
			)}
		</div>
	);
};

import { useMemo, memo } from 'react';
import { minidenticon } from 'minidenticons';
import { Avatar as RadixAvatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useCachedAvatar } from '@/lib/avatarCache';

interface AvatarProps {
  userId: string;
  avatarId?: string;
  size?: number;
  className?: string;
}

export const Avatar = memo(({ userId, avatarId, size = 36, className }: AvatarProps) => {
  const { url: displayUrl } = useCachedAvatar(avatarId);

  const dataUrl = useMemo(() => {
    const svgString = minidenticon(userId, 80, 50);
    return `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;
  }, [userId]);

  return (
    <RadixAvatar 
      className={`rounded-full overflow-hidden ${className || ''}`} 
      style={{ width: size, height: size }}
    >
      {displayUrl && (
        <AvatarImage 
          src={displayUrl} 
          className="object-cover"
          draggable={false}
        />
      )}
      <AvatarFallback className="bg-transparent border-none">
        <img
          src={dataUrl}
          alt={`Avatar for ${userId}`}
          width={size}
          height={size}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            userSelect: 'none',
          }}
        />
      </AvatarFallback>
    </RadixAvatar>
  );
});

Avatar.displayName = 'Avatar';

const PALETTE = [
	'#5865f2', // Blurple
	'#57f287', // Green
	'#fee75c', // Yellow
	'#eb459e', // Pink
	'#ed4245', // Red
	'#3ba55c', // Forest green
	'#faa61a', // Orange
	'#9b59b6', // Purple
	'#00b0f4', // Cyan
	'#e91e63', // Rose
];

function stringHash(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = (hash * 33) ^ str.charCodeAt(i);
	}
	return Math.abs(hash);
}

export function ChannelInitialsAvatar({
	id,
	name,
	size,
	className,
}: {
	id?: string;
	name: string;
	size: number;
	className?: string;
}) {
	const key = id || name || '';
	const color = key ? PALETTE[stringHash(key) % PALETTE.length] : '#5865f2';
	const initials = (name || '')
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? '')
		.join('');

	const text = initials || '#';
	const fontSize = Math.round(size * (text.length > 1 ? 0.38 : 0.44));

	return (
		<div
			className={`rounded-full shrink-0 select-none overflow-hidden flex items-center justify-center font-bold text-white leading-none ${className || ''}`}
			style={{
				width: size,
				height: size,
				backgroundColor: color,
				fontSize: `${fontSize}px`,
			}}
		>
			<span className="leading-none select-none pointer-events-none flex items-center justify-center -translate-y-[0.5px]">
				{text}
			</span>
		</div>
	);
}

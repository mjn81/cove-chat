import { Group, Panel, Separator } from 'react-resizable-panels';

import { cn } from '@/lib/utils';

const ResizablePanelGroup = ({
	className,
	direction,
	...props
}: React.ComponentProps<typeof Group> & {
	direction?: 'horizontal' | 'vertical';
}) => (
	<Group
		orientation={direction}
		className={cn(
			'flex h-full w-full data-[panel-group-direction=vertical]:flex-col',
			className,
		)}
		{...props}
	/>
);

const ResizablePanel = Panel;

const ResizableHandle = ({
	withHandle,
	className,
	...props
}: React.ComponentProps<typeof Separator> & {
	withHandle?: boolean;
}) => (
	<Separator
		className={cn(
			'group relative flex w-px items-center justify-center bg-border z-50',
			'cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-[10px] after:-translate-x-1/2 focus-visible:outline-none',
			className,
		)}
		{...props}
	>
		{withHandle && (
			<>
				{/* Highlight bar: visible on hover, and while actively dragging (data-separator="active") */}
				<span
					className={cn(
						'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
						'w-[5px] h-12 rounded-full bg-primary/70 opacity-0 transition-all duration-150',
						'group-hover:opacity-100',
						'group-data-[separator=active]:opacity-100 group-data-[separator=active]:bg-primary',
					)}
				/>
				{/* Simple hover tooltip */}
				<span className="pointer-events-none absolute left-1/2 top-1/2 translate-x-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md opacity-0 transition-opacity duration-150 delay-300 group-hover:opacity-100 z-50">
					Drag to resize
				</span>
			</>
		)}
	</Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };

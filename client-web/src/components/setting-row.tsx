import * as React from 'react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface SettingRowProps {
	/** Already-translated setting name. */
	title: string;
	/** Already-translated explanation under the title. */
	description?: string;
	/** The control at the end of the row (`Switch`, `Select`, `Button`, ...). */
	children: React.ReactNode;
	className?: string;
}

/**
 * Title/description on one side, control on the other. The layout for every
 * row on the settings pages (Android: `CoveSwitchRow` for the switch case).
 */
export const SettingRow: React.FC<SettingRowProps> = ({
	title,
	description,
	children,
	className,
}) => (
	<div className={cn('flex items-center justify-between gap-4 py-3', className)}>
		<div className="min-w-0">
			<p className="text-sm font-medium text-foreground">{title}</p>
			{description && <p className="text-xs text-muted-foreground">{description}</p>}
		</div>
		<div className="shrink-0">{children}</div>
	</div>
);

export interface SwitchRowProps extends Omit<SettingRowProps, 'children'> {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
}

/**
 * {@link SettingRow} with a `Switch`, labelled by its title so the toggle has
 * an accessible name.
 *
 * @example
 * <SwitchRow title={t('settings.sounds')} checked={on} onCheckedChange={setOn} />
 */
export const SwitchRow: React.FC<SwitchRowProps> = ({
	checked,
	onCheckedChange,
	disabled,
	...row
}) => (
	<SettingRow {...row}>
		<Switch
			checked={checked}
			onCheckedChange={onCheckedChange}
			disabled={disabled}
			aria-label={row.title}
		/>
	</SettingRow>
);

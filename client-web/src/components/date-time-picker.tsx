import * as React from 'react';
import { enUS, faIR, arSA } from 'date-fns/locale';
import { CalendarIcon, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { isBeforeDay, minuteOptions, pickDay, withTime } from '@/lib/date-time';
import { cn } from '@/lib/utils';

/** react-day-picker locales for the languages the app ships. */
const CALENDAR_LOCALES = { en: enUS, fa: faIR, ar: arSA } as const;

export interface DateTimePickerProps {
	/** Selected moment, or `undefined` for none. */
	value: Date | undefined;
	onChange: (value: Date | undefined) => void;
	/** Earlier days are disabled. */
	minDate?: Date;
	/** Time used when a day is picked before any time was chosen. Defaults to 12:00. */
	defaultTime?: readonly [number, number];
	/** Already-translated placeholder shown while empty. */
	placeholder?: string;
	disabled?: boolean;
	/** Show a clear button when a value is set (for optional fields). Defaults to true. */
	clearable?: boolean;
	/** Passed to the trigger so a `FormField` label points at it. */
	id?: string;
	className?: string;
	'aria-describedby'?: string;
	'aria-invalid'?: boolean;
}

/**
 * Date + time field built from the Shadcn `Calendar`, `Popover` and `Select`.
 * Picking a day keeps the chosen time; changing the time keeps the day.
 * Follows the app language and text direction.
 *
 * @example
 * <FormField label={t('admin.invites.expires')}>
 *   {(c) => <DateTimePicker {...c} value={date} onChange={setDate} minDate={new Date()} />}
 * </FormField>
 */
export function DateTimePicker({
	value,
	onChange,
	minDate,
	defaultTime = [12, 0],
	placeholder,
	disabled,
	clearable = true,
	id,
	className,
	...aria
}: DateTimePickerProps) {
	const { t, i18n } = useTranslation();
	const [open, setOpen] = React.useState(false);
	const lang = i18n.language.split('-')[0] as keyof typeof CALENDAR_LOCALES;

	const label = value
		? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
		: (placeholder ?? t('common.pick_date_time'));

	const setTimePart = (hours: number, minutes: number) =>
		onChange(withTime(value ?? new Date(), hours, minutes));

	return (
		<div className={cn('flex items-center gap-1', className)}>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						id={id}
						type="button"
						variant="outline"
						disabled={disabled}
						className={cn('flex-1 justify-start font-normal', !value && 'text-muted-foreground')}
						{...aria}
					>
						<CalendarIcon />
						<span className="truncate">{label}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-auto p-0" align="start">
					<Calendar
						mode="single"
						selected={value}
						defaultMonth={value ?? minDate}
						onSelect={(day) => day && onChange(pickDay(day, value, defaultTime))}
						disabled={minDate ? (day) => isBeforeDay(day, minDate) : undefined}
						locale={CALENDAR_LOCALES[lang] ?? enUS}
						dir={i18n.dir()}
						autoFocus
					/>
					<div className="flex items-center gap-2 border-t border-border p-3">
						<Select
							value={String(value?.getHours() ?? defaultTime[0])}
							onValueChange={(h) => setTimePart(Number(h), value?.getMinutes() ?? defaultTime[1])}
						>
							<SelectTrigger aria-label={t('common.hour')} className="w-20">
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="max-h-60">
								{Array.from({ length: 24 }, (_, h) => (
									<SelectItem key={h} value={String(h)}>
										{String(h).padStart(2, '0')}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<span aria-hidden="true">:</span>
						<Select
							value={String(value?.getMinutes() ?? defaultTime[1])}
							onValueChange={(m) => setTimePart(value?.getHours() ?? defaultTime[0], Number(m))}
						>
							<SelectTrigger aria-label={t('common.minute')} className="w-20">
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="max-h-60">
								{minuteOptions(value?.getMinutes()).map((m) => (
									<SelectItem key={m} value={String(m)}>
										{String(m).padStart(2, '0')}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button type="button" size="sm" className="ms-auto" onClick={() => setOpen(false)}>
							{t('common.done')}
						</Button>
					</div>
				</PopoverContent>
			</Popover>
			{clearable && value && !disabled && (
				<Button
					type="button"
					size="icon"
					variant="ghost"
					aria-label={t('common.clear')}
					onClick={() => onChange(undefined)}
				>
					<X />
				</Button>
			)}
		</div>
	);
}

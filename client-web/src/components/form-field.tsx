import * as React from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * The shared "required" marker: every required field label ends with ` *`.
 * Rendered here once so forms never hand-type the asterisk.
 */
export const RequiredMark: React.FC = () => (
	<span aria-hidden="true" className="text-destructive">
		{' *'}
	</span>
);

/** Props injected into the control rendered by {@link FormField}. */
export interface FormFieldControlProps {
	id: string;
	'aria-invalid': boolean;
	'aria-describedby': string | undefined;
	'aria-required': boolean | undefined;
}

export interface FormFieldProps {
	/** Already-translated label text. */
	label: string;
	/** Appends the shared ` *` marker and sets `aria-required` on the control. */
	required?: boolean;
	/** Already-translated helper text shown under the control. */
	hint?: string;
	/** Already-translated validation message; replaces the hint and marks the control invalid. */
	error?: string;
	className?: string;
	/** Render prop receiving the a11y props to spread on an `Input`, `Textarea`, `SelectTrigger`, ... */
	children: (control: FormFieldControlProps) => React.ReactNode;
}

/**
 * Label + control + hint/error wrapper that wires `htmlFor`, `aria-invalid`
 * and `aria-describedby` so every form field is built the same way.
 *
 * @example
 * <FormField label={t('auth.username')} required error={errors.username}>
 *   {(c) => <Input {...c} {...register('username')} />}
 * </FormField>
 */
export const FormField: React.FC<FormFieldProps> = ({
	label,
	required,
	hint,
	error,
	className,
	children,
}) => {
	const id = React.useId();
	const messageId = error || hint ? `${id}-message` : undefined;

	return (
		<div className={cn('space-y-1.5', className)}>
			<Label htmlFor={id}>
				{label}
				{required && <RequiredMark />}
			</Label>
			{children({
				id,
				'aria-invalid': Boolean(error),
				'aria-describedby': messageId,
				'aria-required': required || undefined,
			})}
			{messageId && (
				<p
					id={messageId}
					role={error ? 'alert' : undefined}
					className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
				>
					{error ?? hint}
				</p>
			)}
		</div>
	);
};

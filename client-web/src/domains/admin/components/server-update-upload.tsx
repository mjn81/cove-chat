import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/form-field';
import { useUploadServerUpdate } from '../api/use-admin';
import { adminErrorMessage } from '../utils/admin-errors';
import { classifyChecksumInput } from '../utils/server-update';
import type { ServerUploadInfo } from '../types/admin.types';

/**
 * Offline update for installs that cannot reach GitHub or covechat.dev: the owner uploads the release zip (or the
 * plain binary) with its version and, ideally, its checksum. This only stages the file; the Install button in the
 * panel applies it with the same swap, rollback copy and restart as an online update.
 */
export function ServerUpdateUpload({
	uploaded,
	onInstall,
	disabled,
}: {
	uploaded: ServerUploadInfo | undefined;
	/** Opens the panel's confirm dialog for installing the staged upload. */
	onInstall: () => void;
	disabled: boolean;
}) {
	const { t } = useTranslation();
	const upload = useUploadServerUpdate();
	const [file, setFile] = useState<File | null>(null);
	const [version, setVersion] = useState('');
	const [checksum, setChecksum] = useState('');

	const submit = async () => {
		if (!file) return;
		try {
			await upload.mutateAsync({ file, version: version.trim(), ...classifyChecksumInput(checksum) });
			toast.success(t('admin.update.upload_done'));
			setFile(null);
		} catch (err) {
			toast.error(adminErrorMessage(t, err));
		}
	};

	return (
		<details className="rounded-lg border border-border p-3 text-sm">
			<summary className="cursor-pointer font-medium text-foreground">{t('admin.update.upload_title')}</summary>
			<div className="mt-3 space-y-3">
				<p className="text-xs text-muted-foreground">{t('admin.update.upload_body')}</p>
				<FormField label={t('admin.update.upload_file')} required>
					{(control) => (
						<Input
							{...control}
							type="file"
							accept=".zip,application/zip,application/octet-stream"
							onChange={(e) => setFile(e.target.files?.[0] ?? null)}
						/>
					)}
				</FormField>
				<FormField label={t('admin.update.upload_version')} required>
					{(control) => (
						<Input
							{...control}
							dir="ltr"
							value={version}
							onChange={(e) => setVersion(e.target.value)}
							placeholder="0.10.0"
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
						/>
					)}
				</FormField>
				<FormField label={t('admin.update.upload_sha')} hint={t('admin.update.upload_sha_hint')}>
					{(control) => (
						<Textarea
							{...control}
							dir="ltr"
							rows={2}
							value={checksum}
							onChange={(e) => setChecksum(e.target.value)}
							autoComplete="off"
							spellCheck={false}
						/>
					)}
				</FormField>
				<Button
					variant="outline"
					size="sm"
					onClick={() => void submit()}
					disabled={!file || version.trim() === '' || upload.isPending || disabled}
				>
					<Upload />
					{upload.isPending ? t('admin.update.uploading') : t('admin.update.upload_button')}
				</Button>

				{uploaded && (
					<div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-2">
						<p className="text-xs text-foreground">
							{t('admin.update.uploaded', {
								version: uploaded.version,
								checked: uploaded.verified ? t('admin.update.checked_yes') : t('admin.update.checked_no'),
							})}
						</p>
						<Button size="sm" onClick={onInstall} disabled={disabled}>
							{t('admin.update.apply')}
						</Button>
					</div>
				)}
			</div>
		</details>
	);
}

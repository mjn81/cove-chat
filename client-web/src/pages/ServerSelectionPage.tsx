import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { setApiBaseUrl } from '@/api/client';
import { isWails } from '@/utils/wails';
import { APP_NAME } from '@/lib/brand';
import { DEMO_SERVER_URL, findReachableServer } from '@/lib/server-url';
import { GetServerURL, SaveServerURL } from '../wailsjs/go/main/App';

/**
 * First-run step where the user picks the server this client talks to. A bare domain is probed over
 * https first (see `serverUrlCandidates`), so `demo.covechat.dev` works without typing a scheme.
 */
export default function ServerSelectionPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [url, setUrl] = useState('');
	const [status, setStatus] = useState<
		'idle' | 'checking' | 'success' | 'error'
	>('idle');
	const [error, setError] = useState('');

	useEffect(() => {
		// The desktop shell remembers the last server between launches.
		const restore = async () => {
			if (!isWails()) return;
			const savedUrl = await GetServerURL();
			if (savedUrl) {
				setUrl(savedUrl);
				setApiBaseUrl(savedUrl);
			}
		};
		restore();
	}, []);

	const connectTo = async (address: string) => {
		if (!address.trim()) return;

		setStatus('checking');
		setError('');

		const origin = await findReachableServer(address);
		if (!origin) {
			setStatus('error');
			setError(t('serverSelect.failed'));
			return;
		}

		setUrl(origin);
		setStatus('success');
		setApiBaseUrl(origin);
		if (isWails()) await SaveServerURL(origin);

		// Short delay for visual feedback
		setTimeout(() => {
			navigate('/login');
		}, 800);
	};

	const handleConnect = (e: React.FormEvent) => {
		e.preventDefault();
		void connectTo(url);
	};

	return (
		<div className="flex h-screen w-full flex-col items-center justify-center bg-background relative overflow-hidden">
			<Card className="w-full max-w-[480px] bg-background border-none sm:bg-secondary/50 sm:backdrop-blur-md sm:shadow-lg sm:p-4 text-foreground z-10">
				<CardHeader className="text-center space-y-2 pb-6">
					<CardTitle className="text-2xl font-bold text-foreground tracking-wide">
						{t('serverSelect.title')}
					</CardTitle>
					<CardDescription className="text-muted-foreground text-base">
						{t('serverSelect.subtitle')}
					</CardDescription>
				</CardHeader>

				<CardContent>
					{error && (
						<div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md mb-4 border border-destructive/20 text-center">
							{error}
						</div>
					)}
					{status === 'success' && (
						<div className="bg-success/10 text-success text-sm p-3 rounded-md mb-4 border border-success/20 text-center">
							{t('serverSelect.connected')}
						</div>
					)}

					<form onSubmit={handleConnect} className="space-y-4">
						<div className="space-y-2">
							<Label
								htmlFor="server-url"
								className="text-xs uppercase font-bold text-muted-foreground"
							>
								{t('serverSelect.address')}
								<span className="text-destructive ms-1">*</span>
							</Label>
							<Input
								id="server-url"
								placeholder={t('serverSelect.placeholder')}
								className="bg-popover border-none text-[15px] h-10 text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								disabled={status === 'checking' || status === 'success'}
								autoFocus
								required
							/>
						</div>

						<Button
							type="submit"
							className="w-full h-11 bg-primary hover:opacity-90 text-primary-foreground font-medium text-base mt-2 transition-colors"
							disabled={!url || status === 'checking' || status === 'success'}
						>
							{status === 'checking' ? <span className="spinner" /> : t('serverSelect.connect')}
						</Button>
					</form>

					<div className="mt-5 flex flex-col items-center gap-1.5 border-t border-border pt-4 text-center">
						<span className="text-xs text-muted-foreground">{t('serverSelect.demoHint')}</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={status === 'checking' || status === 'success'}
							onClick={() => {
								setUrl(DEMO_SERVER_URL);
								void connectTo(DEMO_SERVER_URL);
							}}
						>
							{t('serverSelect.useDemo')}
						</Button>
						<span className="text-[11px] text-muted-foreground/70">{t('serverSelect.demoNote')}</span>
					</div>
				</CardContent>

				<CardFooter className="flex flex-col items-start gap-2 pt-2">
					<div className="text-[11px] text-center text-muted-foreground/60 leading-relaxed italic">
						{t('serverSelect.trustNote', { app: APP_NAME })}
					</div>
				</CardFooter>
			</Card>

			<div className="absolute bottom-8 flex flex-col items-center gap-1 opacity-40 hover:opacity-100 transition-opacity duration-300">
				<p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground select-none">
					{t('serverSelect.openSource', { app: APP_NAME })}
				</p>
				<p className="text-[10px] font-medium text-muted-foreground select-none">
					{t('serverSelect.madeBy')} <span className="text-foreground">mjn</span>
				</p>
			</div>
		</div>
	);
}

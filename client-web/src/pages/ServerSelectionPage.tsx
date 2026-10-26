import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function ServerSelectionPage() {
	const navigate = useNavigate();
	const [url, setUrl] = useState('');
	const [status, setStatus] = useState<
		'idle' | 'checking' | 'success' | 'error'
	>('idle');
	const [error, setError] = useState('');

	useEffect(() => {
		// If we are in Wails, check for existing URL
		const checkWails = async () => {
			if (isWails()) {
				const wails = (window as any).go.main.App;
				if (wails.GetServerURL) {
					const savedUrl = await wails.GetServerURL();
					if (savedUrl) {
						setUrl(savedUrl);
						setApiBaseUrl(savedUrl);
					}
				}
			}
		};
		checkWails();
	}, []);

	const handleConnect = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!url) return;

		setStatus('checking');
		setError('');

		let normalizedUrl = url.trim();
		if (!normalizedUrl.startsWith('http')) {
			normalizedUrl = `http://${normalizedUrl}`;
		}

		try {
			const testRes = await fetch(`${normalizedUrl}/api/version`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!testRes.ok) throw new Error('Server returned an error');

			const data = await testRes.json();
			if (!data.version) throw new Error('Invalid server response');

			setStatus('success');
			setApiBaseUrl(normalizedUrl);

			// Persist in Wails if available
			if (isWails()) {
				const wails = (window as any).go.main.App;
				if (wails.SaveServerURL) {
					await wails.SaveServerURL(normalizedUrl);
				}
			}

			// Short delay for visual feedback
			setTimeout(() => {
				navigate('/login');
			}, 800);
		} catch (err) {
			console.error('Connection failed:', err);
			setStatus('error');
			setError('Could not connect to the server. Please check the URL.');
		}
	};

	return (
		<div className="flex h-screen w-full flex-col items-center justify-center bg-background relative overflow-hidden">
			<Card className="w-full max-w-[480px] bg-background border-none sm:bg-secondary/50 sm:backdrop-blur-md sm:shadow-lg sm:p-4 text-foreground z-10">
				<CardHeader className="text-center space-y-2 pb-6">
					<CardTitle className="text-2xl font-bold text-foreground tracking-wide">
						Select a Server
					</CardTitle>
					<CardDescription className="text-muted-foreground text-base">
						Where are we heading today?
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
							Successfully connected!
						</div>
					)}

					<form onSubmit={handleConnect} className="space-y-4">
						<div className="space-y-2">
							<Label
								htmlFor="server-url"
								className="text-xs uppercase font-bold text-muted-foreground"
							>
								Server Address
								<span className="text-destructive ms-1">*</span>
							</Label>
							<Input
								id="server-url"
								placeholder="https://chat.example.com"
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
							{status === 'checking' ? <span className="spinner" /> : 'Connect'}
						</Button>
					</form>
				</CardContent>

				<CardFooter className="flex flex-col items-start gap-2 pt-2">
					<div className="text-[11px] text-center text-muted-foreground/60 leading-relaxed italic">
						{APP_NAME} stores your messages securely, but relies on the server for
						key management. Ensure you trust the host before sending sensitive
						data
					</div>
				</CardFooter>
			</Card>

			<div className="absolute bottom-8 flex flex-col items-center gap-1 opacity-40 hover:opacity-100 transition-opacity duration-300">
				<p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground select-none">
					{APP_NAME} is open source
				</p>
				<p className="text-[10px] font-medium text-muted-foreground select-none">
					made with ❤️ by <span className="text-foreground">mjn</span>
				</p>
			</div>
		</div>
	);
}

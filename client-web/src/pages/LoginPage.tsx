import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
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
import { isWails } from '@/utils/wails';
import { useAuthStore } from '@/store/store';
import { BASE_URL } from '@/api/client';

export default function LoginPage() {
	const { t } = useTranslation();
	const login = useAuthStore((state) => state.login);
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		if (!username || !password) {
			setError(t('auth.errors.required'));
			return;
		}
		setLoading(true);
		try {
			await login(username, password);
		} catch (err: unknown) {
			setError(t((err as Error).message) || t('auth.errors.login_failed'));
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex h-screen w-full flex-col items-center justify-center bg-background relative overflow-hidden">
			<Card className="w-full max-w-[480px] bg-background border-0 sm:border sm:border-border sm:bg-secondary/50 sm:backdrop-blur-md sm:shadow-lg sm:p-4 text-foreground z-10">
				<CardHeader className="text-center space-y-2 pb-6">
					<CardTitle className="text-2xl font-bold text-foreground tracking-wide">
						Welcome back!
					</CardTitle>
					<CardDescription className="text-muted-foreground text-base">
						We're so excited to see you again!
					</CardDescription>
				</CardHeader>
				<CardContent>
					{error && (
						<div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md mb-4 border border-destructive/20 text-center">
							{error}
						</div>
					)}
					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="space-y-2">
							<Label
								htmlFor="login-username"
								className="text-xs uppercase font-bold text-muted-foreground"
							>
								{t('auth.username')}
								<span className="text-destructive ml-1">*</span>
							</Label>
							<Input
								id="login-username"
								className="bg-popover border-none text-[15px] h-10 text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
								value={username}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
									setUsername(e.target.value)
								}
								autoComplete="username"
								autoCorrect="off"
								autoCapitalize="none"
								autoFocus
								required
							/>
						</div>
						<div className="space-y-2">
							<Label
								htmlFor="login-password"
								className="text-xs uppercase font-bold text-muted-foreground"
							>
								{t('auth.password')}
								<span className="text-destructive ml-1">*</span>
							</Label>
							<div className="relative">
								<Input
									id="login-password"
									type={showPassword ? 'text' : 'password'}
									className="bg-popover border-none text-[15px] h-10 text-foreground focus-visible:ring-0 focus-visible:ring-offset-0 pr-10"
									value={password}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
										setPassword(e.target.value)
									}
									autoComplete="current-password"
									required
								/>
								<button
									type="button"
									onClick={() => setShowPassword((prev) => !prev)}
									className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground focus:outline-none flex items-center justify-center transition-colors"
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									tabIndex={-1}
								>
									{showPassword ? (
										<EyeOff className="h-4 w-4" />
									) : (
										<Eye className="h-4 w-4" />
									)}
								</button>
							</div>
						</div>
						<Button
							type="submit"
							className="w-full h-11 bg-primary hover:opacity-90 text-primary-foreground font-medium text-base mt-2 transition-colors"
							disabled={loading}
						>
							{loading ? <span className="spinner" /> : 'Log In'}
						</Button>
					</form>

					<div className="text-sm text-muted-foreground mt-4 text-center">
						Need an account?{' '}
						<Link
							to="/register"
							className="text-primary hover:underline font-medium"
						>
							Register
						</Link>
					</div>
				</CardContent>

				{isWails() && (
					<CardFooter className="flex flex-col items-start gap-2 pt-2">
						<div className="mt-4 pt-4 border-t border-border/10 w-full flex items-center justify-between text-[11px] text-muted-foreground/60 italic">
							<span>Connecting to: {BASE_URL}</span>
							<Link
								to="/connect"
								className="text-primary hover:underline not-italic font-medium"
							>
								Change
							</Link>
						</div>
					</CardFooter>
				)}
			</Card>

			<div className="absolute bottom-8 flex flex-col items-center gap-1 opacity-40 hover:opacity-100 transition-opacity duration-300">
				<p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground select-none">
					NodeTalk is open source
				</p>
				<p className="text-[10px] font-medium text-muted-foreground select-none">
					made with ❤️ by <span className="text-foreground">mjn</span>
				</p>
			</div>
		</div>
	);
}

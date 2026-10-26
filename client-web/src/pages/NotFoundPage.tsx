import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Home, HelpCircle, Compass } from 'lucide-react';
import { APP_NAME } from '@/lib/brand';

export default function NotFoundPage() {
	return (
		<div className="flex h-screen w-full flex-col items-center justify-center bg-background text-foreground relative overflow-hidden">
			{/* Subtle background icons with reduced opacity and no weird rotations */}
			<div className="absolute top-[15%] start-[10%] opacity-5 select-none">
				<HelpCircle size={160} strokeWidth={1.5} />
			</div>
			<div className="absolute bottom-[15%] end-[10%] opacity-5 select-none">
				<Compass size={180} strokeWidth={1.5} />
			</div>

			<div className="z-10 flex flex-col items-center text-center px-6 max-w-md animate-in fade-in zoom-in duration-500">
				{/* Refined 404 Header - Flat and Clean */}
				<div className="flex flex-col items-center mb-10">
					<span className="text-[140px] font-black leading-none tracking-tighter text-secondary select-none">
						404
					</span>
					<div className="mt-[-20px] bg-primary text-primary-foreground px-5 py-1.5 rounded-full font-black text-sm uppercase tracking-[0.2em]">
						Wrong Turn
					</div>
				</div>

				<h2 className="text-2xl font-bold mb-3 tracking-tight">You're lost in the void.</h2>
				<p className="text-[15px] text-muted-foreground/80 mb-10 leading-relaxed font-medium">
					This page doesn't exist or has been moved to a different dimension. 
					Don't worry, even the best explorers get lost sometimes.
				</p>

				<div className="flex flex-col sm:flex-row gap-3 w-full">
					<Button asChild className="flex-1 h-11 text-[14px] font-bold bg-primary hover:bg-primary/90 rounded-md transition-all active:scale-95 shadow-none">
						<Link to="/">
							<Home className="me-2 h-4 w-4" />
							Take me home
						</Link>
					</Button>
					<Button asChild variant="secondary" className="flex-1 h-11 text-[14px] font-bold bg-secondary hover:bg-secondary/80 rounded-md transition-all active:scale-95 shadow-none">
						<a href="https://github.com/mjn81/nodetalk" target="_blank" rel="noreferrer">
							Report a bug
						</a>
					</Button>
				</div>
			</div>

			{/* Minimalist footer */}
			<div className="absolute bottom-10 flex flex-col items-center gap-1 opacity-20">
				<p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground select-none">
					{APP_NAME} / 404 Error
				</p>
			</div>
		</div>
	);
}

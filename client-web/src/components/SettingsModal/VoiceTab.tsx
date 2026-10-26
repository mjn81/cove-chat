
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Play, Square } from 'lucide-react';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/store/store';

export const VoiceTab = () => {
	const { t } = useTranslation();
	const { preferredMicId: selectedId, setPreferredMicId } = useAppStore();
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
	const [isTesting, setIsTesting] = useState(false);
	const [volume, setVolume] = useState(0);
	const audioContextRef = useRef<AudioContext | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const animationRef = useRef<number | null>(null);

	const stopTest = () => {
		if (animationRef.current) cancelAnimationFrame(animationRef.current);
		if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
		if (audioContextRef.current) {
			if (audioContextRef.current.state !== 'closed') {
				audioContextRef.current.close();
			}
		}
		setIsTesting(false);
		setVolume(0);
	};

	useEffect(() => {
		const getDevices = async () => {
			try {
				// On macOS Wails, we sometimes need to explicitly trigger the system permission dialog
				const wails = (window as any).go?.main?.App;
				if (wails?.RequestMicrophonePermission) {
					await wails.RequestMicrophonePermission();
				}

				// Request permission first to get device labels
				await navigator.mediaDevices.getUserMedia({ audio: true });
				const allDevices = await navigator.mediaDevices.enumerateDevices();
				const mics = allDevices.filter(d => d.kind === 'audioinput');
				setDevices(mics);
			} catch (err) {
				console.error('Error fetching devices:', err);
			}
		};
		getDevices();

		return () => {
			stopTest();
		};
	}, []);

	const handleDeviceChange = (id: string) => {
		setPreferredMicId(id);
		if (isTesting) {
			stopTest();
			startTest(id);
		}
	};

	const startTest = async (deviceId: string) => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } }
			});
			streamRef.current = stream;
			
			const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
			audioContextRef.current = audioContext;
			
			const source = audioContext.createMediaStreamSource(stream);
			const analyser = audioContext.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);
			
			const bufferLength = analyser.frequencyBinCount;
			const dataArray = new Uint8Array(bufferLength);
			
			const updateVolume = () => {
				analyser.getByteFrequencyData(dataArray);
				let sum = 0;
				for (let i = 0; i < bufferLength; i++) {
					sum += dataArray[i];
				}
				const average = sum / bufferLength;
				setVolume(average);
				animationRef.current = requestAnimationFrame(updateVolume);
			};
			
			updateVolume();
			setIsTesting(true);
		} catch (err) {
			console.error('Error testing mic:', err);
		}
	};

	return (
		<div className="w-full max-w-[500px] mx-auto animate-in fade-in slide-in-from-right-4 duration-300">
			<h2 className="text-xl font-bold text-foreground mb-5">
				{t('settings.voice_video')}
			</h2>

			<div className="space-y-8">
				{/* Microphone Selection */}
				<section>
					<h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
						{t('settings.input_device')}
					</h3>
					<Select value={selectedId || 'default'} onValueChange={handleDeviceChange}>
						<SelectTrigger id="mic-select" aria-label={t('settings.input_device')}>
							<span className="flex min-w-0 items-center gap-2">
								<Mic size={16} className="shrink-0 text-muted-foreground" />
								<SelectValue />
							</span>
						</SelectTrigger>
						<SelectContent>
							{devices.length === 0 && (
								<SelectItem value="default">{t('settings.default_device')}</SelectItem>
							)}
							{devices.map((device) => (
								<SelectItem key={device.deviceId} value={device.deviceId || 'default'}>
									{device.label ||
										t('settings.microphone_n', { id: device.deviceId.slice(0, 5) })}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-[11px] text-muted-foreground mt-2 px-1">
						{t('settings.mic_help')}
					</p>
				</section>

				{/* Input Volume & Test */}
				<section>
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
							{t('settings.input_volume')}
						</h3>
						<button
							onClick={isTesting ? stopTest : () => startTest(selectedId)}
							className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition-all ${
								isTesting 
									? 'bg-destructive/10 text-destructive hover:bg-destructive/20' 
									: 'bg-primary/10 text-primary hover:bg-primary/20'
							}`}
						>
							{isTesting ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
							{isTesting ? t('settings.stop_test') : t('settings.test_mic')}
						</button>
					</div>
					
					<div className="h-4 w-full bg-secondary/50 rounded-full overflow-hidden flex gap-0.5 p-1 shadow-inner border border-border/50">
						{[...Array(24)].map((_, i) => {
							// Each segment represents about 4.16% of the range (100 / 24)
							const segmentThreshold = (i * 100) / 24;
							const isActive = volume > segmentThreshold;
							
							// Color shifts: 0-16 primary, 16-20 yellow, 20-24 red
							let colorClass = 'bg-primary';
							if (i > 20) colorClass = 'bg-destructive';
							else if (i > 16) colorClass = 'bg-warning';

							return (
								<div 
									key={i}
									className={`flex-1 rounded-[2px] transition-all duration-75 ${
										isActive 
											? colorClass
											: 'bg-muted/20'
									}`}
									style={{
										opacity: isActive ? 1 : 0.2,
									}}
								/>
							);
						})}
					</div>
					<div className="flex justify-between mt-1 px-1">
						<span className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">Silent</span>
						<span className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">Loud</span>
					</div>
				</section>

				{/* Additional Info */}
				<section className="bg-primary/5 border border-primary/10 rounded-lg p-4">
					<div className="flex gap-3">
						<div className="mt-0.5">
							<Mic className="text-primary" size={20} />
						</div>
						<div className="space-y-1">
							<h4 className="text-sm font-bold text-foreground">
								{t('settings.wip_title')}
							</h4>
							<p className="text-xs text-muted-foreground leading-relaxed">
								Echo cancellation, noise suppression, and automatic gain control settings are currently managed by your operating system. Advanced controls will be available in the next version.
							</p>
						</div>
					</div>
				</section>
			</div>
		</div>
	);
};

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
	ChevronUp,
	Headphones,
	HeadphoneOff,
	Maximize2,
	Mic,
	MicOff,
	Minimize2,
	Monitor,
	PhoneOff,
	Video,
	VideoOff,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Switch } from '../ui/switch';
import { webRTCManager } from '@/rtc/WebRTCManager';
import { useVoiceStore } from '@/store/voiceStore';
import { STREAM_PRESETS, matchStreamPreset, type StreamPresetId } from './call-layout';

const BUTTON = 'h-11 w-11 rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0';
const NEUTRAL = 'bg-secondary text-foreground hover:bg-accent';
const DANGER = 'bg-destructive text-destructive-foreground hover:bg-destructive/90';

const PRESET_ORDER: StreamPresetId[] = ['smooth', 'balanced', 'sharp'];
const PRESET_CAPTION: Record<StreamPresetId, string> = {
	smooth: '720p · 60 fps',
	balanced: '1080p · 30 fps',
	sharp: 'Source · 30 fps',
};

/** Screen share quality: three presets and one switch, replacing the old four-picker menu. */
const StreamSettings: React.FC = () => {
	const { t } = useTranslation();
	const settings = useVoiceStore((s) => s.screenShareSettings);
	const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
	const active = matchStreamPreset(settings);

	return (
		<div className="flex flex-col gap-3">
			<div>
				<div className="mb-2 text-xs font-semibold text-foreground">{t('call.quality')}</div>
				<div className="grid grid-cols-3 gap-1.5">
					{PRESET_ORDER.map((id) => (
						<button
							key={id}
							type="button"
							onClick={() => void webRTCManager.applyScreenShareConstraints(STREAM_PRESETS[id])}
							className={`flex flex-col items-center rounded-lg border px-1 py-2 text-xs transition-colors cursor-pointer ${
								active === id
									? 'border-primary bg-primary/10 text-foreground'
									: 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
							}`}
						>
							<span className="font-semibold">{t(`call.${id}`)}</span>
							<span className="mt-0.5 text-[10px] opacity-80">{PRESET_CAPTION[id]}</span>
						</button>
					))}
				</div>
			</div>
			<label className="flex items-center justify-between gap-3 text-xs text-foreground">
				<span>{t('call.shareAudio')}</span>
				<Switch
					checked={settings.includeAudio}
					disabled={isScreenSharing}
					onCheckedChange={(includeAudio) =>
						useVoiceStore.getState().setScreenShareSettings({ includeAudio })
					}
				/>
			</label>
		</div>
	);
};

interface CallControlsProps {
	isFullscreen: boolean;
	onToggleFullscreen: () => void;
	/** Omit to hide the minimise button (the floating panel has nothing to collapse into). */
	onMinimize?: () => void;
	/** Overrides the fullscreen button's label, e.g. when it returns to the call's chat instead. */
	fullscreenLabel?: string;
}

/**
 * Bottom control dock, Meet-style: round toggles for mic, camera, screen share (with a quality popover) and
 * deafen, then fullscreen / minimise, then a wide red leave button. Active states: red = off / muted.
 */
export const CallControls: React.FC<CallControlsProps> = ({
	isFullscreen,
	onToggleFullscreen,
	onMinimize,
	fullscreenLabel,
}) => {
	const { t } = useTranslation();
	const isMuted = useVoiceStore((s) => s.isMuted);
	const isDeafened = useVoiceStore((s) => s.isDeafened);
	const isVideoEnabled = useVoiceStore((s) => s.isVideoEnabled);
	const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
	// Until the server answers call_join there is no PeerConnection, so media buttons would be silent no-ops.
	const ready = useVoiceStore((s) => s.callStatus === 'connected');
	const wait = ready ? '' : ' opacity-50 pointer-events-none';

	return (
		<div className="flex flex-wrap items-center justify-center gap-2 py-1">
			<button
				type="button"
				onClick={() => void webRTCManager.toggleMute()}
				className={`${BUTTON} ${isMuted ? DANGER : NEUTRAL}${wait}`}
				title={isMuted ? t('call.unmute') : t('call.mute')}
				aria-label={isMuted ? t('call.unmute') : t('call.mute')}
				aria-pressed={isMuted}
			>
				{isMuted ? <MicOff size={19} /> : <Mic size={19} />}
			</button>

			<button
				type="button"
				onClick={() => void webRTCManager.toggleVideo()}
				className={`${BUTTON} ${isVideoEnabled ? NEUTRAL : DANGER}${wait}`}
				title={isVideoEnabled ? t('call.cameraOff') : t('call.cameraOn')}
				aria-label={isVideoEnabled ? t('call.cameraOff') : t('call.cameraOn')}
				aria-pressed={isVideoEnabled}
			>
				{isVideoEnabled ? <Video size={19} /> : <VideoOff size={19} />}
			</button>

			<div className={`flex items-center${wait}`}>
				<button
					type="button"
					onClick={() => void webRTCManager.toggleScreenShare()}
					className={`h-11 ps-3.5 pe-2.5 rounded-s-full flex items-center gap-1.5 text-sm font-medium transition-colors cursor-pointer ${
						isScreenSharing ? 'bg-primary text-primary-foreground hover:bg-primary/90' : NEUTRAL
					}`}
					title={isScreenSharing ? t('call.stopShare') : t('call.share')}
					aria-label={isScreenSharing ? t('call.stopShare') : t('call.share')}
					aria-pressed={isScreenSharing}
				>
					<Monitor size={19} />
				</button>
				<Popover>
					<PopoverTrigger asChild>
						<button
							type="button"
							className={`h-11 w-8 rounded-e-full border-s border-border/60 flex items-center justify-center transition-colors cursor-pointer ${
								isScreenSharing ? 'bg-primary text-primary-foreground hover:bg-primary/90' : NEUTRAL
							}`}
							title={t('call.settings')}
							aria-label={t('call.settings')}
						>
							<ChevronUp size={14} />
						</button>
					</PopoverTrigger>
					<PopoverContent side="top" align="center" sideOffset={10} className="w-64 p-3">
						<StreamSettings />
					</PopoverContent>
				</Popover>
			</div>

			<button
				type="button"
				onClick={() => webRTCManager.toggleDeafen()}
				className={`${BUTTON} ${isDeafened ? DANGER : NEUTRAL}`}
				title={isDeafened ? t('call.undeafen') : t('call.deafen')}
				aria-label={isDeafened ? t('call.undeafen') : t('call.deafen')}
				aria-pressed={isDeafened}
			>
				{isDeafened ? <HeadphoneOff size={19} /> : <Headphones size={19} />}
			</button>

			<div className="mx-1 h-6 w-px bg-border" />

			<button
				type="button"
				onClick={onToggleFullscreen}
				className={`${BUTTON} ${NEUTRAL}`}
				title={fullscreenLabel ?? (isFullscreen ? t('call.exitFullscreen') : t('call.fullscreen'))}
				aria-label={fullscreenLabel ?? (isFullscreen ? t('call.exitFullscreen') : t('call.fullscreen'))}
			>
				{isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
			</button>
			{!isFullscreen && onMinimize && (
				<button
					type="button"
					onClick={onMinimize}
					className={`${BUTTON} ${NEUTRAL}`}
					title={t('call.minimize')}
					aria-label={t('call.minimize')}
				>
					<ChevronUp size={18} />
				</button>
			)}

			<button
				type="button"
				onClick={() => void webRTCManager.leave()}
				className={`h-11 px-5 rounded-full flex items-center justify-center transition-colors cursor-pointer ${DANGER}`}
				title={t('call.leave')}
				aria-label={t('call.leave')}
			>
				<PhoneOff size={19} />
			</button>
		</div>
	);
};

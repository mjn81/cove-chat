import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ReactCrop, { centerCrop, makeAspectCrop, type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { RotateCw, ZoomIn, ZoomOut, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { IconButton } from '@/components/icon-button';
import { ModalShell } from '@/components/modal-shell';

interface ImageEditorProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	file: File | null;
	onSave: (blob: Blob, mime: string) => void;
	aspectRatio?: number;
	circularCrop?: boolean;
	maxSizeMB?: number;
}

function centerAspectCrop(mediaWidth: number, mediaHeight: number, aspect: number): Crop {
	return centerCrop(
		makeAspectCrop(
			{
				unit: '%',
				width: 90,
			},
			aspect,
			mediaWidth,
			mediaHeight,
		),
		mediaWidth,
		mediaHeight,
	);
}

/**
 * Crop / zoom / rotate dialog for avatars and banners. Calls `onSave` with the
 * edited blob; SVGs that were not touched are passed through as vectors.
 *
 * @param file - Image chosen by the user; `null` clears the editor.
 * @param maxSizeMB - Larger files show an error instead of loading.
 */
export const ImageEditor: React.FC<ImageEditorProps> = ({
	open,
	onOpenChange,
	file,
	onSave,
	aspectRatio = 1,
	circularCrop = true,
	maxSizeMB = 5,
}) => {
	const { t } = useTranslation();
	const [imgSrc, setImgSrc] = useState<string>('');
	const [crop, setCrop] = useState<Crop>();
	const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
	const [scale, setScale] = useState(1);
	const [rotate, setRotate] = useState(0);
	const [isSvg, setIsSvg] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const imgRef = useRef<HTMLImageElement | null>(null);

	useEffect(() => {
		if (!file) {
			// Resetting editor state when the source file is cleared; there is no render-time equivalent for the FileReader flow below.
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setImgSrc('');
			setError(null);
			return;
		}

		if (file.size > maxSizeMB * 1024 * 1024) {
			setError(t('image_editor.too_large', { size: maxSizeMB }));
			return;
		}

		setError(null);
		setIsSvg(file.type === 'image/svg+xml' || file.name.endsWith('.svg'));
		setScale(1);
		setRotate(0);

		const reader = new FileReader();
		reader.addEventListener('load', () => {
			setImgSrc(reader.result?.toString() || '');
		});
		reader.readAsDataURL(file);
	}, [file, maxSizeMB, t]);

	function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
		const { width, height } = e.currentTarget;
		setCrop(centerAspectCrop(width, height, aspectRatio));
	}

	const handleRotate = () => {
		setRotate((prev) => (prev + 90) % 360);
	};

	const handleApply = async () => {
		if (!file) return;

		// If SVG and user did not rotate or scale, we can keep the pure vector SVG
		if (isSvg && rotate === 0 && scale === 1 && !completedCrop) {
			onSave(file, 'image/svg+xml');
			onOpenChange(false);
			return;
		}

		const image = imgRef.current;
		if (!image) {
			if (file) onSave(file, file.type);
			onOpenChange(false);
			return;
		}

		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const scaleX = image.naturalWidth / image.width;
		const scaleY = image.naturalHeight / image.height;

		const pixelCrop = completedCrop || {
			x: 0,
			y: 0,
			width: image.width,
			height: image.height,
			unit: 'px',
		};

		const outputWidth = Math.max(pixelCrop.width * scaleX, 100);
		const outputHeight = Math.max(pixelCrop.height * scaleY, 100);

		canvas.width = outputWidth;
		canvas.height = outputHeight;

		ctx.save();
		ctx.imageSmoothingQuality = 'high';

		// Center canvas for rotation
		ctx.translate(outputWidth / 2, outputHeight / 2);
		ctx.rotate((rotate * Math.PI) / 180);
		ctx.scale(scale, scale);
		ctx.translate(-outputWidth / 2, -outputHeight / 2);

		ctx.drawImage(
			image,
			pixelCrop.x * scaleX,
			pixelCrop.y * scaleY,
			pixelCrop.width * scaleX,
			pixelCrop.height * scaleY,
			0,
			0,
			outputWidth,
			outputHeight,
		);
		ctx.restore();

		const outMime = isSvg ? 'image/png' : file.type || 'image/jpeg';
		canvas.toBlob(
			(blob) => {
				if (blob) {
					onSave(blob, outMime);
					onOpenChange(false);
				}
			},
			outMime,
			0.92,
		);
	};

	return (
		<ModalShell
			open={open}
			onOpenChange={onOpenChange}
			title={t('image_editor.title')}
			footer={
				<>
					<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
						{t('common.cancel')}
					</Button>
					<Button type="button" onClick={handleApply} disabled={!!error || !imgSrc}>
						<Check className="h-4 w-4" />
						{t('image_editor.apply')}
					</Button>
				</>
			}
		>
			{error ? (
				<div
					role="alert"
					className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
				>
					{error}
				</div>
			) : (
				<div className="flex flex-col items-center gap-4">
					{isSvg && (
						<div className="flex w-full flex-col gap-0.5 rounded-md border border-border bg-muted p-2.5 text-xs">
							<span className="text-foreground">{t('image_editor.svg_detected')}</span>
							<span className="text-muted-foreground">{t('image_editor.svg_hint')}</span>
						</div>
					)}

					<div className="relative flex max-h-[340px] max-w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted p-2">
						{imgSrc && (
							<ReactCrop
								crop={crop}
								onChange={(_, percentCrop) => setCrop(percentCrop)}
								onComplete={(c) => setCompletedCrop(c)}
								aspect={aspectRatio}
								circularCrop={circularCrop}
								className="max-h-[300px]"
							>
								<img
									ref={imgRef}
									src={imgSrc}
									alt={t('image_editor.preview_alt')}
									onLoad={onImageLoad}
									style={{
										transform: `scale(${scale}) rotate(${rotate}deg)`,
										maxHeight: '300px',
										objectFit: 'contain',
									}}
									crossOrigin="anonymous"
								/>
							</ReactCrop>
						)}
					</div>

					<div className="flex w-full items-center gap-4">
						<div className="flex flex-1 items-center gap-2">
							<ZoomOut className="h-4 w-4 shrink-0 text-muted-foreground" />
							<Slider
								min={0.5}
								max={3}
								step={0.1}
								value={[scale]}
								onValueChange={([v]) => setScale(v)}
								aria-label={t('image_editor.zoom')}
							/>
							<ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
						</div>

						<IconButton label={t('image_editor.rotate')} onClick={handleRotate}>
							<RotateCw className="h-4 w-4" />
						</IconButton>
					</div>
				</div>
			)}
		</ModalShell>
	);
};

import React, { useState, useRef, useEffect } from 'react';
import ReactCrop, { centerCrop, makeAspectCrop, type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RotateCw, ZoomIn, ZoomOut, Check, X, FileImage } from 'lucide-react';

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

export const ImageEditor: React.FC<ImageEditorProps> = ({
	open,
	onOpenChange,
	file,
	onSave,
	aspectRatio = 1,
	circularCrop = true,
	maxSizeMB = 5,
}) => {
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
			setImgSrc('');
			setError(null);
			return;
		}

		if (file.size > maxSizeMB * 1024 * 1024) {
			setError(`File exceeds maximum size of ${maxSizeMB}MB`);
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
	}, [file, maxSizeMB]);

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
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md bg-zinc-950 border border-zinc-800 text-zinc-100 p-6 rounded-2xl shadow-2xl">
				<DialogHeader>
					<DialogTitle className="text-lg font-semibold flex items-center gap-2">
						<FileImage className="w-5 h-5 text-indigo-400" />
						Edit Photo
					</DialogTitle>
				</DialogHeader>

				{error ? (
					<div className="p-4 rounded-xl bg-red-950/40 border border-red-900/50 text-red-300 text-sm">
						{error}
					</div>
				) : (
					<div className="flex flex-col items-center gap-4 my-2">
						{isSvg && (
							<div className="w-full text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 flex items-center justify-between">
								<span>Vector SVG file detected</span>
								<span className="text-indigo-400">Scale / Rotate converts to HD raster</span>
							</div>
						)}

						<div className="relative max-h-[340px] max-w-full overflow-hidden flex items-center justify-center rounded-xl bg-zinc-900/80 border border-zinc-800/80 p-2">
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
										alt="Crop preview"
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

						{/* Controls: Zoom slider & Rotate */}
						<div className="w-full flex items-center gap-4 px-2">
							<div className="flex items-center gap-2 flex-1">
								<ZoomOut className="w-4 h-4 text-zinc-500" />
								<input
									type="range"
									min={0.5}
									max={3}
									step={0.1}
									value={scale}
									onChange={(e) => setScale(parseFloat(e.target.value))}
									className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
								/>
								<ZoomIn className="w-4 h-4 text-zinc-500" />
							</div>

							<Button
								type="button"
								variant="outline"
								size="icon"
								onClick={handleRotate}
								className="h-8 w-8 rounded-lg bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
								title="Rotate 90 degrees"
							>
								<RotateCw className="w-4 h-4" />
							</Button>
						</div>
					</div>
				)}

				<DialogFooter className="flex items-center justify-end gap-2 pt-2">
					<Button
						type="button"
						variant="ghost"
						onClick={() => onOpenChange(false)}
						className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
					>
						<X className="w-4 h-4 mr-1.5" />
						Cancel
					</Button>
					<Button
						type="button"
						onClick={handleApply}
						disabled={!!error || !imgSrc}
						className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-600/20"
					>
						<Check className="w-4 h-4 mr-1.5" />
						Apply Photo
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

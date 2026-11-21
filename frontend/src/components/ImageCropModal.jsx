import { useState, useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import getCroppedImg from '../utils/cropImage';
import useFocusTrap from '../hooks/useFocusTrap';

/**
 * The crop dialog. It mounts only while open, so the focus trap's unmount
 * hands focus back to whatever opened it (the file input).
 */
export default function ImageCropModal({ isOpen, imageSrc, ...props }) {
    if (!isOpen || !imageSrc) return null;
    return <CropDialog imageSrc={imageSrc} {...props} />;
}

function CropDialog({
    imageSrc,
    aspect,
    mediaType = 'image',
    sourceMimeType = '',
    cropShape = 'rect',
    onClose,
    onApply,
    title = 'Edit media'
}) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const titleId = useId();
    const zoomId = useId();

    // Escape closes, but not while a crop is being written out.
    const isProcessingRef = useRef(false);
    isProcessingRef.current = isProcessing;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const handleEscape = useCallback(() => {
        if (!isProcessingRef.current) onCloseRef.current?.();
    }, []);
    const dialogRef = useFocusTrap(true, handleEscape);

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    const onCropComplete = useCallback((croppedArea, croppedAreaPixels) => {
        setCroppedAreaPixels(croppedAreaPixels);
    }, []);

    const handleApply = async () => {
        if (!croppedAreaPixels || !imageSrc) return;

        try {
            setIsProcessing(true);
            const isBannerCrop = mediaType === 'banner';
            const supportsTransparency = ['image/png', 'image/webp', 'image/gif'].includes(
                String(sourceMimeType || '').toLowerCase()
            );
            const outputType = supportsTransparency ? 'image/png' : 'image/webp';
            const croppedBlob = await getCroppedImg(
                imageSrc,
                croppedAreaPixels,
                0,
                { horizontal: false, vertical: false },
                isBannerCrop ? 1500 : 400, // Max width: 1500 for banner, 400 for avatar
                outputType
            );

            if (croppedBlob) {
                // Convert to File
                const fileExtension = outputType === 'image/png' ? 'png' : 'webp';
                const fileName = isBannerCrop ? `banner.${fileExtension}` : `avatar.${fileExtension}`;
                const file = new File([croppedBlob], fileName, { type: outputType });
                const previewUrl = URL.createObjectURL(croppedBlob);
                onApply(file, previewUrl);
            }
        } catch (e) {
            console.error('Failed to crop image:', e);
        } finally {
            setIsProcessing(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[2000] flex items-center justify-center sm:p-4">
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={() => !isProcessing && onClose()}
            />

            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="relative w-full h-svh sm:h-auto max-h-full sm:max-w-2xl sm:max-h-[90vh] bg-dark-100 sm:rounded-2xl border border-gray-800 overflow-hidden shadow-2xl flex flex-col animate-modal-in">

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 sm:py-3 bg-dark-200 shrink-0 z-10">
                    <div className="flex items-center gap-2 sm:gap-4">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isProcessing}
                            aria-label="Close"
                            className="p-2 -ml-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
                        >
                            <X className="w-5 h-5 text-white" aria-hidden="true" />
                        </button>
                        <h2 id={titleId} className="text-base sm:text-lg font-bold text-white truncate">{title}</h2>
                    </div>
                    <button
                        type="button"
                        onClick={handleApply}
                        disabled={isProcessing}
                        className="px-4 py-1.5 bg-white text-black hover:bg-gray-200 font-bold rounded-full transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2 text-sm"
                    >
                        {isProcessing ? 'Processing...' : 'Apply'}
                    </button>
                </div>

                {/* Cropper Container */}
                <div className="relative flex-1 min-h-[200px] sm:min-h-[300px] sm:h-[60vh] bg-black">
                    <Cropper
                        image={imageSrc}
                        crop={crop}
                        zoom={zoom}
                        aspect={aspect}
                        cropShape={cropShape}
                        showGrid={false}
                        onCropChange={setCrop}
                        onCropComplete={onCropComplete}
                        onZoomChange={setZoom}
                        classes={{
                            containerClassName: 'absolute inset-0',
                            cropAreaClassName: cropShape === 'rect' && aspect === 1 ? '!rounded-2xl' : ''
                        }}
                    />
                </div>

                {/* Controls */}
                <div className="px-6 py-3 sm:py-4 bg-dark-200 shrink-0 z-10">
                    <div className="flex items-center gap-4 max-w-md mx-auto">
                        <button
                            type="button"
                            onClick={() => setZoom(z => Math.max(1, z - 0.1))}
                            aria-label="Zoom out"
                            className="p-2 text-gray-400 hover:text-white transition-colors"
                        >
                            <ZoomOut className="w-5 h-5" aria-hidden="true" />
                        </button>

                        <label htmlFor={zoomId} className="sr-only">Zoom</label>
                        <input
                            id={zoomId}
                            type="range"
                            value={zoom}
                            min={1}
                            max={3}
                            step={0.01}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-accent"
                        />

                        <button
                            type="button"
                            onClick={() => setZoom(z => Math.min(3, z + 0.1))}
                            aria-label="Zoom in"
                            className="p-2 text-gray-400 hover:text-white transition-colors"
                        >
                            <ZoomIn className="w-5 h-5" aria-hidden="true" />
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

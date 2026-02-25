import React, { useState, useCallback, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import getCroppedImg from '../utils/cropImage';

export default function ImageCropModal({
    isOpen,
    imageSrc,
    aspect,
    cropShape = 'rect',
    onClose,
    onApply,
    title = 'Edit media'
}) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            setCrop({ x: 0, y: 0 });
            setZoom(1);
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen && !isProcessing) onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose, isProcessing]);

    const onCropComplete = useCallback((croppedArea, croppedAreaPixels) => {
        setCroppedAreaPixels(croppedAreaPixels);
    }, []);

    const handleApply = async () => {
        if (!croppedAreaPixels || !imageSrc) return;
        
        try {
            setIsProcessing(true);
            const croppedBlob = await getCroppedImg(
                imageSrc,
                croppedAreaPixels,
                0,
                { horizontal: false, vertical: false },
                aspect === 3 ? 1500 : 400 // Max width: 1500 for banner, 400 for avatar
            );
            
            if (croppedBlob) {
                // Convert to File
                const fileName = aspect === 3 ? 'banner.webp' : 'avatar.webp';
                const file = new File([croppedBlob], fileName, { type: 'image/webp' });
                const previewUrl = URL.createObjectURL(croppedBlob);
                onApply(file, previewUrl);
            }
        } catch (e) {
            console.error('Failed to crop image:', e);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isOpen || !imageSrc) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4">
            <div 
                className="absolute inset-0 bg-black/80 backdrop-blur-sm" 
                onClick={() => !isProcessing && onClose()}
            />
            
            <div className="relative w-full h-full sm:h-auto sm:max-w-2xl sm:max-h-[90vh] bg-dark-100 sm:rounded-2xl border border-gray-800 overflow-hidden shadow-2xl flex flex-col animate-modal-in">
                
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-dark-200 shrink-0 z-10">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onClose}
                            disabled={isProcessing}
                            className="p-2 -ml-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
                        >
                            <X className="w-5 h-5 text-white" />
                        </button>
                        <h2 className="text-lg font-bold text-white">{title}</h2>
                    </div>
                    <button
                        onClick={handleApply}
                        disabled={isProcessing}
                        className="px-4 py-1.5 bg-white text-black hover:bg-gray-200 font-bold rounded-full transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2 text-sm"
                    >
                        {isProcessing ? 'Processing...' : 'Apply'}
                    </button>
                </div>

                {/* Cropper Container */}
                <div className="relative flex-1 sm:h-[60vh] min-h-[300px] bg-black">
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
                <div className="px-6 py-4 bg-dark-200 border-t border-white/10 shrink-0 z-10">
                    <div className="flex items-center gap-4 max-w-md mx-auto">
                        <button 
                            onClick={() => setZoom(z => Math.max(1, z - 0.1))}
                            className="p-2 text-gray-400 hover:text-white transition-colors"
                        >
                            <ZoomOut className="w-5 h-5" />
                        </button>
                        
                        <input
                            type="range"
                            value={zoom}
                            min={1}
                            max={3}
                            step={0.01}
                            aria-labelledby="Zoom"
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-accent"
                        />
                        
                        <button 
                            onClick={() => setZoom(z => Math.min(3, z + 0.1))}
                            className="p-2 text-gray-400 hover:text-white transition-colors"
                        >
                            <ZoomIn className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

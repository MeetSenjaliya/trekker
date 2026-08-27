import imageCompression from 'browser-image-compression';

export async function compressImage(file: File) {
    const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        // The library's worker is a blob: shell that importScripts() itself from
        // jsdelivr, which CSP script-src blocks. It falls back to this same
        // main-thread path anyway, minus a third-party fetch on every upload.
        useWebWorker: false,
    };
    try {
        const compressedFile = await imageCompression(file, options);
        return compressedFile;
    } catch (error) {
        console.error('Image compression failed:', error);
        return file; // Fallback to original file
    }
}

export function sanitizeFileName(fileName: string) {
    return fileName
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/[^a-zA-Z0-9.\-_]/g, ''); // Remove non-alphanumeric characters except dots, hyphens, and underscores
}

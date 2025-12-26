import imageCompression from 'browser-image-compression';

export async function compressImage(file: File) {
    const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
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

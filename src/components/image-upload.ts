import { sanitizeImage } from '../lib/image-sanitize';
export async function prepareImageUpload(file: File): Promise<File> {
  if (file.type === 'application/pdf') return file;
  sanitizeImage(new Uint8Array(await file.arrayBuffer()), file.type);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * ratio);
    canvas.height = Math.round(image.naturalHeight * ratio);
    const context = canvas.getContext('2d');
    if (!context) throw Error('浏览器无法处理图片，请换用系统浏览器');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error('图片压缩未完成，请重试'))),
        'image/webp',
        0.84,
      ),
    );
    const type = ['image/webp', 'image/png', 'image/jpeg'].includes(blob.type)
      ? blob.type
      : file.type;
    const bytes = sanitizeImage(new Uint8Array(await blob.arrayBuffer()), type).bytes;
    return new File(
      [bytes as BlobPart],
      file.name.replace(/\.[^.]+$/, '') +
        '.' +
        (type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg'),
      { type },
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

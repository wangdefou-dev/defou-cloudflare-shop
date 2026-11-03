interface Photo {
  srcSet: string;
  avifSrcSet: string;
  placeholder: string;
  width: number;
  height: number;
  alt: string;
}

export default function ResponsivePhoto({
  photo,
  sizes,
  priority = false,
  audience = 'desktop',
  className = '',
  imageClassName,
  position = 'center',
}: {
  photo: Photo;
  sizes: string;
  priority?: boolean;
  audience?: 'mobile' | 'desktop';
  className?: string;
  imageClassName?: string;
  position?: string;
}) {
  const media = audience === 'mobile' ? '(max-width: 1000px)' : '(min-width: 1001px)';
  return (
    <picture
      className={'responsive-picture ' + className}
      style={{ backgroundImage: `url("${photo.placeholder}")`, backgroundPosition: position }}
    >
      {photo.avifSrcSet && <source type="image/avif" media={media} srcSet={photo.avifSrcSet} sizes={sizes} />}
      <source media={media} srcSet={photo.srcSet} sizes={sizes} />
      <img
        className={imageClassName}
        src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
        width={photo.width}
        height={photo.height}
        alt={photo.alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
      />
    </picture>
  );
}

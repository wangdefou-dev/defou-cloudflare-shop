import { PRODUCT_IMAGE } from '../lib/product-image';
import { shopImage } from '../lib/media';
import ResponsivePhoto from './ResponsivePhoto';

export default function ProductPhoto({
  sku,
  sizes,
  priority = false,
  audience = 'desktop',
  src,
}: {
  sku: string;
  sizes: string;
  priority?: boolean;
  audience?: 'mobile' | 'desktop';
  /** Image uploaded in the admin; replaces the built-in responsive photo. */
  src?: string | null;
}) {
  if (src && PRODUCT_IMAGE.test(src))
    return (
      <picture className="responsive-picture product-picture">
        <img
          src={src}
          alt={shopImage(sku).alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
        />
      </picture>
    );
  return (
    <ResponsivePhoto
      photo={shopImage(sku)}
      sizes={sizes}
      priority={priority}
      audience={audience}
      className="product-picture"
    />
  );
}

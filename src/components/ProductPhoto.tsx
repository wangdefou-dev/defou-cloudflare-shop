import { shopImage } from '../lib/media';
import ResponsivePhoto from './ResponsivePhoto';

export default function ProductPhoto({
  sku,
  sizes,
  priority = false,
  audience = 'desktop',
}: {
  sku: string;
  sizes: string;
  priority?: boolean;
  audience?: 'mobile' | 'desktop';
}) {
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

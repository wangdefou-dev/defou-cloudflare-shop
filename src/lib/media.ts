import prepared from './image-assets.json';
import { STORE, onStoreChange } from './store-config';

type Custom = { src: string; width: number; height: number; alt?: string } | null;
// Encoding details and content hashes are generated from the approved local masters.
// A photo set in the site content (images) replaces the built-in one as a plain image file.
type Slot = keyof typeof STORE.images;
function photo(name: keyof typeof prepared.photos, alt: string, key?: Slot) {
  const custom = key ? ((STORE.images as Record<string, Custom>)[key] ?? null) : null;
  if (custom)
    return {
      src: custom.src,
      thumbnail: custom.src,
      width: custom.width,
      height: custom.height,
      srcSet: '',
      avifSrcSet: '',
      placeholder: '',
      alt: custom.alt || alt,
    };
  return { ...prepared.photos[name], alt };
}

const shopImages = () => ({
  FAMILY: photo('family', '红富士苹果与新鲜切面，置于浅色纸托中', 'FAMILY'),
  GIFT: photo('gift', '八颗红富士苹果整齐放在素色礼盒中', 'GIFT'),
  PA: photo('peace', '秋日果园中挂着素色木牌的苹果树', 'PA'),
  FG: photo('fortune', '成熟苹果树枝头的大颗红富士苹果', 'FG'),
});
const sceneImages = () => ({
  ORCHARD: photo('orchard', '太行山深处的秋日红苹果', 'hero'),
  ADOPTION: SHOP_IMAGES.PA,
  COMMUNITY: photo('community', '桌上的苹果、茶杯和书本', 'community'),
});
// Live bindings: replaced when the site content's images change.
export let SHOP_IMAGES = shopImages();
export let SCENE_IMAGES = sceneImages();
onStoreChange(() => {
  SHOP_IMAGES = shopImages();
  SCENE_IMAGES = sceneImages();
});

export function shopImage(sku: string) {
  return SHOP_IMAGES[sku as keyof typeof SHOP_IMAGES] || SHOP_IMAGES.FAMILY;
}

export function imageDimensions(src: string) {
  return (
    [...Object.values(SHOP_IMAGES), ...Object.values(SCENE_IMAGES)].find(
      (photo) => photo.src === src,
    ) || {
      width: 1536,
      height: 1024,
    }
  );
}

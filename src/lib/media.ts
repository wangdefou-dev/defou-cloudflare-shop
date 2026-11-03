import prepared from './image-assets.json';

// Encoding details and content hashes are generated from the approved local masters.
function photo(name: keyof typeof prepared.photos, alt: string) {
  return { ...prepared.photos[name], alt };
}

export const SHOP_IMAGES = {
  FAMILY: photo('family', '红富士苹果与新鲜切面，置于浅色纸托中'),
  GIFT: photo('gift', '八颗红富士苹果整齐放在素色礼盒中'),
  PA: photo('peace', '秋日果园中挂着素色木牌的苹果树'),
  FG: photo('fortune', '成熟苹果树枝头的大颗红富士苹果'),
} as const;

export const SCENE_IMAGES = {
  ORCHARD: photo('orchard', '山间果园的秋日红苹果'),
  ADOPTION: SHOP_IMAGES.PA,
  COMMUNITY: photo('community', '桌上的苹果、茶杯和书本'),
} as const;
export const BRAND_IMAGE = prepared.brand;

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

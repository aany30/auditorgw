export { detectPlatform, extractProductId, resolveProductUrl } from './detect';
export { getPlatformDefinition, listMarketplaceDefinitions } from './definitions';
export {
  scrapeMarketplaceProduct,
  searchMarketplaceCandidates,
  scrapeMarketplaceCompetitor,
  extractNykaaRelatedFromPdp,
} from './scrape';
export type { PlatformId } from './types';
export { MARKETPLACE_PLATFORMS } from './types';

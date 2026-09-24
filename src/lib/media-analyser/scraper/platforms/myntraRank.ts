import { isTitleCompatible } from '../services/ecomAgent/competitorSwarm';
import type { CompetitorCandidate, ProductData } from '../services/ecomAgent/scraper';

/** Higher = better competitor for deep scrape / LLM analysis. */
export function scoreMyntraCandidate(
  target: ProductData,
  c: CompetitorCandidate,
  searchPosition: number,
): number {
  let score = Math.max(0, 1000 - searchPosition * 15);

  const title = c.title ?? '';
  if (title && isTitleCompatible(target.title, title)) score += 400;

  const rating = Number(c.avgRating ?? 0);
  const reviews = Number(c.numRatings ?? 0);
  if (rating > 0) score += rating * 80;
  if (reviews > 0) score += Math.min(200, Math.log10(reviews + 1) * 45);

  // Deprioritize listings with no social proof
  if (rating <= 0 && reviews <= 0) score -= 300;

  return score;
}

export function rankMyntraCandidates(
  target: ProductData,
  candidates: CompetitorCandidate[],
): CompetitorCandidate[] {
  return [...candidates]
    .map((c, i) => ({ c, score: scoreMyntraCandidate(target, c, c.rank ?? i) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

export function rankMyntraProducts(
  target: ProductData,
  products: ProductData[],
): ProductData[] {
  return [...products].sort((a, b) => {
    const score = (p: ProductData) => {
      let s = 0;
      if (isTitleCompatible(target.title, p.title)) s += 400;
      const r = Number(p.rating ?? 0);
      const n = Number(p.ratings_total ?? p.reviews_total ?? 0);
      if (r > 0) s += r * 80;
      if (n > 0) s += Math.min(200, Math.log10(n + 1) * 45);
      return s;
    };
    return score(b) - score(a);
  });
}

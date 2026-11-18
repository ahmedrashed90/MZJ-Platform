import type { WorkFormat } from '../../../shared/marketing-workflow';
import type { ProductionDimension } from '../types';

/** Production sizes have no destination platform, format type or extra outputs. */
export function productionWorkFormats(dimensions: readonly ProductionDimension[]): WorkFormat[] {
  const seen = new Set<string>();
  return dimensions.filter(dimension => {
    const width = Number(dimension.width), height = Number(dimension.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return false;
    const key = `${width}x${height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(dimension => ({
    id: dimension.id,
    name: `${dimension.width} × ${dimension.height}`,
    width: dimension.width,
    height: dimension.height,
    platform_id: '', platform_name: '', platform_code: '',
  })).sort((left, right) => Number(left.width) * Number(left.height) - Number(right.width) * Number(right.height)
    || Number(left.width) - Number(right.width));
}

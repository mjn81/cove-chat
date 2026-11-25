import { describe, expect, it } from 'vitest';
import { previewPhases, type RoadmapPhase } from './roadmap';

const phase = (id: string, count: number): RoadmapPhase => ({
  id,
  title: id,
  subtitle: id,
  progress: 0,
  items: Array.from({ length: count }, (_, i) => ({ id: `${id}${i}`, phase: id, status: 'planned', area: 'chat', title: 't', note: 'n' })),
});
const ids = (phases: RoadmapPhase[]) => previewPhases(phases).map((p) => p.id);

describe('previewPhases', () => {
  it('shows shipped, in progress and next', () => {
    expect(ids([phase('shipped', 1), phase('now', 1), phase('next', 1), phase('later', 1)])).toEqual(['shipped', 'now', 'next']);
  });
  it('skips an empty phase so no column is blank', () => {
    expect(ids([phase('shipped', 1), phase('now', 0), phase('next', 1), phase('later', 1)])).toEqual(['shipped', 'next', 'later']);
  });
});

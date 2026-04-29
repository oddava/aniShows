import { describe, expect, it } from 'vitest';

import { filterBrowseGenres } from './realGenres';

describe('filterBrowseGenres', () => {
  it('keeps only real browse genres', () => {
    expect(
      filterBrowseGenres([
        { slug: 'action', name: 'Action' },
        { slug: 'award-winning', name: 'Award Winning' },
        { slug: 'boys-love', name: 'Boys Love' },
        { slug: 'girls-love', name: 'Girls Love' },
        { slug: 'romance', name: 'Romance' },
      ])
    ).toEqual([
      { slug: 'action', name: 'Action' },
      { slug: 'romance', name: 'Romance' },
    ]);
  });
});

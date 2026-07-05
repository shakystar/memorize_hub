import { describe, expect, it } from 'vitest';

import { isDerivedStoreId, isReservedId, isValidStoreId, newId } from '../../src/ids.js';

describe('der_ derived-store ids', () => {
  it('mints a der_-prefixed, path-safe id', () => {
    const id = newId('der');
    expect(id.startsWith('der_')).toBe(true);
    expect(isValidStoreId(id)).toBe(true);
  });

  it('recognises der_ ids', () => {
    expect(isDerivedStoreId(newId('der'))).toBe(true);
    expect(isDerivedStoreId(newId('wsp'))).toBe(false);
    expect(isDerivedStoreId('psm_abc')).toBe(false);
  });

  it('reserves der_ so it is never granted or cloned as a plain project', () => {
    expect(isReservedId(newId('der'))).toBe(true);
  });
});

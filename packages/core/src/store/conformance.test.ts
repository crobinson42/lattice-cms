import { beforeEach, describe, it } from 'vitest';
import { MemoryStore } from '../store.js';
import { storeCases } from './conformance.js';

describe('MemoryStore conformance', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
  });

  it.each(storeCases)('$name', ({ run }) => run(store));
});

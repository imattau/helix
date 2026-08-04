import { describe, expect, it } from 'vitest';
import { BlockGraph } from '../../src/social/blockGraph.js';

describe('BlockGraph', () => {
  it('records a block and answers getBlocked/isBlocked', () => {
    const graph = new BlockGraph();
    graph.addBlock('bob', 'alice');

    expect(graph.getBlocked('bob')).toEqual(['alice']);
    expect(graph.isBlocked('bob', 'alice')).toBe(true);
    expect(graph.isBlocked('alice', 'bob')).toBe(false);
    expect(graph.getBlocked('alice')).toEqual([]);
  });

  it('is idempotent - blocking the same person twice does not duplicate the edge', () => {
    const graph = new BlockGraph();
    graph.addBlock('bob', 'alice');
    graph.addBlock('bob', 'alice');

    expect(graph.getBlocked('bob')).toEqual(['alice']);
  });

  it('removes a block edge on unblock, and is idempotent too', () => {
    const graph = new BlockGraph();
    graph.addBlock('bob', 'alice');
    graph.removeBlock('bob', 'alice');

    expect(graph.getBlocked('bob')).toEqual([]);
    expect(graph.isBlocked('bob', 'alice')).toBe(false);

    // removing an edge that isn't there is a no-op, not a throw
    graph.removeBlock('bob', 'alice');
    graph.removeBlock('carol', 'alice');
    expect(graph.getBlocked('bob')).toEqual([]);
  });

  it('removing one block leaves other edges of the same blocker intact', () => {
    const graph = new BlockGraph();
    graph.addBlock('bob', 'alice');
    graph.addBlock('bob', 'dave');
    graph.removeBlock('bob', 'alice');

    expect(graph.getBlocked('bob')).toEqual(['dave']);
  });

  it('is one-directional and per-blocker: two peers can block the same genome independently', () => {
    const graph = new BlockGraph();
    graph.addBlock('bob', 'alice');
    graph.addBlock('carol', 'alice');

    expect(new Set(graph.getBlocked('bob'))).toEqual(new Set(['alice']));
    expect(new Set(graph.getBlocked('carol'))).toEqual(new Set(['alice']));
    expect(graph.isBlocked('alice', 'bob')).toBe(false);
  });
});

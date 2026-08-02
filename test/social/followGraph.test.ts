import { describe, expect, it } from 'vitest';
import { FollowGraph } from '../../src/social/followGraph.js';

describe('FollowGraph', () => {
  it('records a follow and answers getFollowing/getFollowers', () => {
    const graph = new FollowGraph();
    graph.addFollow('bob', 'alice');

    expect(graph.getFollowing('bob')).toEqual(['alice']);
    expect(graph.getFollowers('alice')).toEqual(['bob']);
    expect(graph.getFollowing('alice')).toEqual([]);
    expect(graph.getFollowers('bob')).toEqual([]);
  });

  it('is idempotent - following the same person twice does not duplicate the edge', () => {
    const graph = new FollowGraph();
    graph.addFollow('bob', 'alice');
    graph.addFollow('bob', 'alice');

    expect(graph.getFollowing('bob')).toEqual(['alice']);
    expect(graph.getFollowers('alice')).toEqual(['bob']);
  });

  it('supports multiple followers and multiple followees', () => {
    const graph = new FollowGraph();
    graph.addFollow('bob', 'alice');
    graph.addFollow('carol', 'alice');
    graph.addFollow('bob', 'dave');

    expect(new Set(graph.getFollowers('alice'))).toEqual(new Set(['bob', 'carol']));
    expect(new Set(graph.getFollowing('bob'))).toEqual(new Set(['alice', 'dave']));
  });

  describe('getFollowersOfFollowers', () => {
    it('returns the 2nd-degree ring over a carol -> bob -> alice chain', () => {
      const graph = new FollowGraph();
      graph.addFollow('bob', 'alice');
      graph.addFollow('carol', 'bob');

      expect(graph.getFollowersOfFollowers('alice')).toEqual(['carol']);
    });

    it('excludes the genome itself even if a follow cycle exists', () => {
      const graph = new FollowGraph();
      graph.addFollow('bob', 'alice');
      graph.addFollow('alice', 'bob'); // mutual follow

      expect(graph.getFollowersOfFollowers('alice')).toEqual([]);
    });

    it('excludes direct followers from the 2nd-degree result', () => {
      const graph = new FollowGraph();
      graph.addFollow('bob', 'alice');
      graph.addFollow('carol', 'alice'); // carol is also a DIRECT follower of alice
      graph.addFollow('carol', 'bob'); // and a follower of bob

      // carol must not appear in alice's followers-of-followers, since she's already
      // a direct follower
      expect(graph.getFollowersOfFollowers('alice')).toEqual([]);
    });

    it('returns an empty array for a genome with no followers', () => {
      const graph = new FollowGraph();
      graph.addFollow('bob', 'alice');
      expect(graph.getFollowersOfFollowers('bob')).toEqual([]);
    });

    it('deduplicates when reached via multiple paths', () => {
      const graph = new FollowGraph();
      graph.addFollow('bob', 'alice');
      graph.addFollow('carol', 'alice');
      graph.addFollow('dave', 'bob');
      graph.addFollow('dave', 'carol'); // dave follows both of alice's direct followers

      expect(graph.getFollowersOfFollowers('alice')).toEqual(['dave']);
    });

    it('does not include a peer who is in the graph but does not follow bob', () => {
      const graph = new FollowGraph();
      graph.addFollow('bob', 'alice');
      graph.addFollow('carol', 'bob');
      graph.addFollow('charlie', 'dave'); // charlie exists in the graph, but has no edge to bob

      expect(graph.getFollowersOfFollowers('alice')).toEqual(['carol']);
      expect(graph.getFollowersOfFollowers('alice')).not.toContain('charlie');
    });

    it('does not include a peer who never touches the graph at all', () => {
      const graph = new FollowGraph();
      graph.addFollow('bob', 'alice');
      graph.addFollow('carol', 'bob');
      // 'charlie' is never passed to addFollow anywhere - not even a node in the graph

      expect(graph.getFollowersOfFollowers('alice')).toEqual(['carol']);
      expect(graph.getFollowers('charlie')).toEqual([]); // querying an unknown genome doesn't throw
    });
  });
});

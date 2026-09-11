import { FlowPipeline, SQLNode, FlowEdge } from '../types';

export interface CyclePathInfo {
  pathNodeIds: string[];
  pathNodeNames: string[];
  edgeIds: string[];
  summary: string;
}

export interface GraphTopologyAnalysis {
  nodes: SQLNode[];
  hasCycle: boolean;
  cycleNodeIds: string[];
  cycleEdgeIds: string[];
  cyclePaths: CyclePathInfo[];
}

/**
 * Performs cycle detection on a directed graph of SQL nodes and edges.
 * Uses DFS with recursion stack to identify all cycles and cycle-participating nodes and edges.
 */
export function analyzeGraphCycles(
  nodes: SQLNode[],
  edges: FlowEdge[]
): {
  hasCycle: boolean;
  cycleNodeIds: string[];
  cycleEdgeIds: string[];
  cyclePaths: CyclePathInfo[];
} {
  const nodeMap = new Map<string, SQLNode>(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, Array<{ targetId: string; edgeId: string }>>();

  nodes.forEach((n) => adjacency.set(n.id, []));
  edges.forEach((edge) => {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      adjacency.get(edge.source)?.push({ targetId: edge.target, edgeId: edge.id });
    }
  });

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: Array<{ nodeId: string; edgeId: string | null }> = [];
  const cyclePaths: CyclePathInfo[] = [];
  const cycleNodeSet = new Set<string>();
  const cycleEdgeSet = new Set<string>();

  function dfs(currentId: string) {
    visited.add(currentId);
    recStack.add(currentId);

    const neighbors = adjacency.get(currentId) || [];
    for (const { targetId, edgeId } of neighbors) {
      if (!visited.has(targetId)) {
        path.push({ nodeId: currentId, edgeId });
        dfs(targetId);
        path.pop();
      } else if (recStack.has(targetId)) {
        // Cycle detected!
        // Find index where cycle starts in current path
        const cycleStartIndex = path.findIndex((p) => p.nodeId === targetId);
        const subPath = cycleStartIndex >= 0 ? path.slice(cycleStartIndex) : [];
        const cycleNodeIds: string[] = subPath.map((p) => p.nodeId);
        cycleNodeIds.push(currentId);
        cycleNodeIds.push(targetId); // close the loop representation

        const cycleEdgeIds: string[] = subPath
          .map((p) => p.edgeId)
          .filter((id): id is string => id !== null);
        cycleEdgeIds.push(edgeId);

        // Deduplicate node IDs for marking
        cycleNodeIds.forEach((id) => cycleNodeSet.add(id));
        cycleEdgeIds.forEach((id) => cycleEdgeSet.add(id));

        const pathNodeNames = cycleNodeIds.map((id) => {
          const n = nodeMap.get(id);
          return n ? n.name : id;
        });

        const summary = pathNodeNames.join(' ➔ ');

        // Prevent duplicate path additions
        if (!cyclePaths.some((cp) => cp.summary === summary)) {
          cyclePaths.push({
            pathNodeIds: cycleNodeIds,
            pathNodeNames,
            edgeIds: cycleEdgeIds,
            summary,
          });
        }
      }
    }

    recStack.delete(currentId);
  }

  nodes.forEach((n) => {
    if (!visited.has(n.id)) {
      dfs(n.id);
    }
  });

  return {
    hasCycle: cyclePaths.length > 0,
    cycleNodeIds: Array.from(cycleNodeSet),
    cycleEdgeIds: Array.from(cycleEdgeSet),
    cyclePaths,
  };
}

/**
 * Checks whether adding/updating an edge from sourceId to targetId will introduce a cycle.
 * Specifically checks if there is already a path from targetId to sourceId.
 */
export function detectCycleIfEdgeAdded(
  nodes: SQLNode[],
  edges: FlowEdge[],
  sourceId: string,
  targetId: string,
  excludeEdgeId?: string
): { createsCycle: boolean; pathNodeIds: string[]; summary: string } {
  if (sourceId === targetId) {
    const node = nodes.find((n) => n.id === sourceId);
    const name = node?.name || sourceId;
    return {
      createsCycle: true,
      pathNodeIds: [sourceId, targetId],
      summary: `${name} ➔ ${name} (Self Loop)`,
    };
  }

  const nodeMap = new Map<string, SQLNode>(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>();

  nodes.forEach((n) => adjacency.set(n.id, []));
  edges.forEach((edge) => {
    if (excludeEdgeId && edge.id === excludeEdgeId) return;
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      adjacency.get(edge.source)?.push(edge.target);
    }
  });

  // Check BFS/DFS if path from targetId to sourceId exists
  const visited = new Set<string>();
  const parentMap = new Map<string, string>();
  const queue: string[] = [targetId];
  visited.add(targetId);

  let pathFound = false;

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === sourceId) {
      pathFound = true;
      break;
    }

    const neighbors = adjacency.get(curr) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parentMap.set(neighbor, curr);
        queue.push(neighbor);
      }
    }
  }

  if (pathFound) {
    // Reconstruct path from targetId to sourceId
    const reversePath: string[] = [sourceId];
    let curr = sourceId;
    while (curr !== targetId && parentMap.has(curr)) {
      curr = parentMap.get(curr)!;
      reversePath.push(curr);
    }
    reversePath.reverse(); // Now targetId -> ... -> sourceId
    const fullCycle = [sourceId, ...reversePath]; // sourceId -> targetId -> ... -> sourceId

    const pathNodeNames = fullCycle.map((id) => nodeMap.get(id)?.name || id);
    const summary = pathNodeNames.join(' ➔ ');

    return {
      createsCycle: true,
      pathNodeIds: fullCycle,
      summary,
    };
  }

  return {
    createsCycle: false,
    pathNodeIds: [],
    summary: '',
  };
}

/**
 * Calculates topological execution order based on edges.
 * Nodes without incoming edges start first.
 * Then breadth-first / Kahn's topological sort assigns sequential executionOrder (1, 2, 3...).
 */
export function recalculatePipelineOrder(
  nodes: SQLNode[],
  edges: FlowEdge[]
): GraphTopologyAnalysis {
  const nodeMap = new Map<string, SQLNode>(nodes.map((n) => [n.id, { ...n }]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  nodes.forEach((n) => {
    inDegree.set(n.id, 0);
    adjacency.set(n.id, []);
  });

  // Build graph
  edges.forEach((edge) => {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target) && edge.source !== edge.target) {
      adjacency.get(edge.source)?.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  });

  // Kahn's algorithm queue
  const queue: string[] = [];
  nodes.forEach((n) => {
    if ((inDegree.get(n.id) || 0) === 0) {
      queue.push(n.id);
    }
  });

  // Sort queue by current position.x or existing executionOrder so order is deterministic
  queue.sort((a, b) => {
    const nodeA = nodeMap.get(a)!;
    const nodeB = nodeMap.get(b)!;
    return nodeA.position.x - nodeB.position.x;
  });

  const orderedNodeIds: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    orderedNodeIds.push(currentId);

    const neighbors = adjacency.get(currentId) || [];
    // Sort neighbors by x coordinate
    neighbors.sort((a, b) => {
      const na = nodeMap.get(a);
      const nb = nodeMap.get(b);
      return (na?.position.x || 0) - (nb?.position.x || 0);
    });

    neighbors.forEach((neighborId) => {
      const newDegree = (inDegree.get(neighborId) || 1) - 1;
      inDegree.set(neighborId, newDegree);
      if (newDegree === 0) {
        queue.push(neighborId);
      }
    });
  }

  // Any remaining nodes (e.g. disconnected or part of a cycle)
  const remaining = nodes.filter((n) => !visited.has(n.id));
  remaining.sort((a, b) => a.position.x - b.position.x);
  remaining.forEach((n) => orderedNodeIds.push(n.id));

  // Run full cycle analysis
  const cycleAnalysis = analyzeGraphCycles(nodes, edges);

  // Assign 1-indexed executionOrder and nextNodeIds
  const updatedNodes: SQLNode[] = orderedNodeIds.map((id, index) => {
    const original = nodeMap.get(id)!;
    const nextNodeIds = edges
      .filter((e) => e.source === id)
      .map((e) => e.target)
      .filter((targetId) => nodeMap.has(targetId));

    return {
      ...original,
      executionOrder: index + 1,
      nextNodeIds,
    };
  });

  return {
    nodes: updatedNodes,
    hasCycle: cycleAnalysis.hasCycle,
    cycleNodeIds: cycleAnalysis.cycleNodeIds,
    cycleEdgeIds: cycleAnalysis.cycleEdgeIds,
    cyclePaths: cycleAnalysis.cyclePaths,
  };
}

/**
 * Creates or updates an edge, and recalculates the pipeline execution order.
 */
export function addOrUpdateEdge(
  pipeline: FlowPipeline,
  sourceId: string,
  targetId: string,
  label?: string,
  existingEdgeId?: string
): FlowPipeline {
  if (sourceId === targetId) return pipeline;

  let newEdges: FlowEdge[];

  if (existingEdgeId) {
    newEdges = pipeline.edges.map((e) =>
      e.id === existingEdgeId
        ? { ...e, source: sourceId, target: targetId, label: label || e.label }
        : e
    );
  } else {
    // Check if edge already exists between this pair
    const exists = pipeline.edges.some((e) => e.source === sourceId && e.target === targetId);
    if (exists) {
      return pipeline;
    }
    const newEdge: FlowEdge = {
      id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      source: sourceId,
      target: targetId,
      label: label || 'Executes Next',
    };
    newEdges = [...pipeline.edges, newEdge];
  }

  const { nodes: updatedNodes } = recalculatePipelineOrder(pipeline.nodes, newEdges);

  return {
    ...pipeline,
    edges: newEdges,
    nodes: updatedNodes,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Removes an edge and recalculates the execution order of nodes.
 */
export function deleteEdge(pipeline: FlowPipeline, edgeId: string): FlowPipeline {
  const newEdges = pipeline.edges.filter((e) => e.id !== edgeId);
  const { nodes: updatedNodes } = recalculatePipelineOrder(pipeline.nodes, newEdges);

  return {
    ...pipeline,
    edges: newEdges,
    nodes: updatedNodes,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Breaks all cycles in a pipeline by removing the minimum set of back-edges that create loops.
 */
export function breakAllCycles(pipeline: FlowPipeline): FlowPipeline {
  const { cycleEdgeIds } = analyzeGraphCycles(pipeline.nodes, pipeline.edges);
  if (cycleEdgeIds.length === 0) return pipeline;

  // Remove the cycle edges
  const cycleEdgeSet = new Set(cycleEdgeIds);
  const newEdges = pipeline.edges.filter((e) => !cycleEdgeSet.has(e.id));
  const { nodes: updatedNodes } = recalculatePipelineOrder(pipeline.nodes, newEdges);

  return {
    ...pipeline,
    edges: newEdges,
    nodes: updatedNodes,
    updatedAt: new Date().toISOString(),
  };
}

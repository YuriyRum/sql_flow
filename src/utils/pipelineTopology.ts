import { FlowPipeline, SQLNode, FlowEdge } from '../types';

/**
 * Calculates topological execution order based on edges.
 * Nodes without incoming edges start first.
 * Then breadth-first / Kahn's topological sort assigns sequential executionOrder (1, 2, 3...).
 */
export function recalculatePipelineOrder(
  nodes: SQLNode[],
  edges: FlowEdge[]
): { nodes: SQLNode[]; hasCycle: boolean } {
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

  const hasCycle = visited.size < nodes.length && edges.length > 0 && remaining.length > 0;

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

  return { nodes: updatedNodes, hasCycle };
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

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FlowPipeline, SQLNode, FlowEdge, QueryType } from '../types';
import {
  Plus,
  Play,
  Download,
  Share2,
  Trash2,
  Copy,
  Maximize2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  MoveUp,
  MoveDown,
  Code2,
  Database,
  ArrowRight,
  Layers,
  Zap,
  Terminal,
  Grid,
  Sparkles,
  RefreshCw,
  FolderOpen,
  GripVertical,
  BookOpen,
  Edit2,
  ZoomIn,
  ZoomOut,
  GitBranch,
  Hand,
  Maximize,
  Focus,
  Repeat,
  Power,
} from 'lucide-react';
import { EdgeEditModal } from './EdgeEditModal';
import {
  addOrUpdateEdge,
  deleteEdge,
  recalculatePipelineOrder,
  analyzeGraphCycles,
  breakAllCycles,
} from '../utils/pipelineTopology';

interface FlowCanvasProps {
  pipeline: FlowPipeline;
  onSelectNode: (node: SQLNode) => void;
  onUpdatePipeline: (pipeline: FlowPipeline) => void;
  onRunSimulation: () => void;
  onExport: () => void;
  onSelectPipeline: (pipelineId: string) => void;
  allPipelines: FlowPipeline[];
  onNewPipeline: () => void;
  onOpenDocumentation: (node: SQLNode) => void;
}

export const FlowCanvas: React.FC<FlowCanvasProps> = ({
  pipeline,
  onSelectNode,
  onUpdatePipeline,
  onRunSimulation,
  onExport,
  onSelectPipeline,
  allPipelines,
  onNewPipeline,
  onOpenDocumentation,
}) => {
  // Board Pan & Zoom State (Scrollbar-free infinite board navigation)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 60, y: 40 });
  const [zoom, setZoom] = useState<number>(1);
  const [isPanning, setIsPanning] = useState<boolean>(false);

  // Node Dragging State
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragNodeInitialPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingNodeRef = useRef<boolean>(false);
  const hasMovedNodeRef = useRef<boolean>(false);
  const lastDragEndTimeRef = useRef<number>(0);
  const dragSuppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mouse Pan tracking ref
  const panStartRef = useRef<{
    startX: number;
    startY: number;
    initialPanX: number;
    initialPanY: number;
  }>({
    startX: 0,
    startY: 0,
    initialPanX: 60,
    initialPanY: 40,
  });

  // Local state and ref for ultra-fast 60/120fps node dragging without pipeline re-renders
  const [draggedNodePos, setDraggedNodePos] = useState<{ id: string; x: number; y: number } | null>(null);
  const draggedNodePosRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const rafDragIdRef = useRef<number | null>(null);

  // Keep references to latest pipeline and zoom for smooth RAF auto-panning
  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

  // Auto-pan animation frame and velocity state while dragging
  const autoPanVelocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const autoPanAnimIdRef = useRef<number | null>(null);
  const currentCursorPosRef = useRef<{ clientX: number; clientY: number } | null>(null);

  // Touch gesture tracking ref (Single finger pan, 2-finger pinch/pan, node drag)
  const touchStateRef = useRef<{
    mode: 'none' | 'pan' | 'pinch' | 'node';
    startX: number;
    startY: number;
    initialPanX: number;
    initialPanY: number;
    initialDist: number;
    initialZoom: number;
    centerPos: { x: number; y: number };
    nodeId?: string;
    nodeInitialPos?: { x: number; y: number };
  }>({
    mode: 'none',
    startX: 0,
    startY: 0,
    initialPanX: 60,
    initialPanY: 40,
    initialDist: 0,
    initialZoom: 1,
    centerPos: { x: 0, y: 0 },
  });

  // Inline Card Title / Description editing state
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardTitle, setCardTitle] = useState('');
  const [cardDesc, setCardDesc] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);

  // Edge editing & interactive connection states
  const [editingEdge, setEditingEdge] = useState<FlowEdge | null>(null);
  const [isEdgeModalOpen, setIsEdgeModalOpen] = useState(false);
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null);

  // Auto-initialize sequence edges if pipeline has nodes but no edges defined
  useEffect(() => {
    if ((!pipeline.edges || pipeline.edges.length === 0) && pipeline.nodes.length >= 2) {
      const autoEdges: FlowEdge[] = [];
      const sorted = [...pipeline.nodes].sort((a, b) => a.executionOrder - b.executionOrder);
      for (let i = 0; i < sorted.length - 1; i++) {
        autoEdges.push({
          id: `edge-${sorted[i].id}-${sorted[i + 1].id}`,
          source: sorted[i].id,
          target: sorted[i + 1].id,
          label: 'Executes Next',
        });
      }
      const { nodes: updatedNodes } = recalculatePipelineOrder(pipeline.nodes, autoEdges);
      onUpdatePipeline({
        ...pipeline,
        edges: autoEdges,
        nodes: updatedNodes,
      });
    }
  }, [pipeline.id]);

  // Complete interactive visual connection between two nodes
  const handleCompleteConnection = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const updated = addOrUpdateEdge(pipeline, sourceId, targetId, 'Executes Next');
    onUpdatePipeline(updated);
    setConnectingSourceId(null);
  };

  const handleSaveEdge = (sourceId: string, targetId: string, label: string, edgeId?: string) => {
    const updated = addOrUpdateEdge(pipeline, sourceId, targetId, label, edgeId);
    onUpdatePipeline(updated);
  };

  const handleDeleteEdge = (edgeId: string) => {
    const updated = deleteEdge(pipeline, edgeId);
    onUpdatePipeline(updated);
  };

  // Compute directed graph cycle analysis
  const cycleAnalysis = useMemo(
    () => analyzeGraphCycles(pipeline.nodes, pipeline.edges),
    [pipeline.nodes, pipeline.edges]
  );

  const handleBreakCycles = () => {
    const broken = breakAllCycles(pipeline);
    onUpdatePipeline(broken);
  };

  // Sorted nodes by execution order
  const sortedNodes = [...pipeline.nodes].sort((a, b) => a.executionOrder - b.executionOrder);

  // Add new node to the pipeline sequence
  const handleAddNode = () => {
    const nextOrder = sortedNodes.length > 0 ? Math.max(...sortedNodes.map((n) => n.executionOrder)) + 1 : 1;
    const lastNode = sortedNodes[sortedNodes.length - 1];
    const newX = lastNode ? lastNode.position.x + 330 : 80;
    const newY = lastNode ? lastNode.position.y : 160;
    const newNodeId = `node-${Date.now()}`;

    const newNode: SQLNode = {
      id: newNodeId,
      name: `${nextOrder.toString().padStart(2, '0')}. New HANA Query Step`,
      description: 'SAP HANA analytical transformation query',
      queryType: 'SELECT',
      sqlContent: `-- SAP HANA Analytical Query Step ${nextOrder}
SELECT 
    "ID",
    "NAME",
    CURRENT_UTCTIMESTAMP AS "PROCESSED_AT"
FROM "STAGE"."STG_DATA"
WHERE "STATUS" = 'ACTIVE';`,
      inputTables: ['"STAGE"."STG_DATA"'],
      parameters: [],
      executionOrder: nextOrder,
      status: 'idle',
      enabled: true,
      position: { x: newX, y: newY },
      nextNodeIds: [],
      validationSummary: { isValid: true, errors: 0, warnings: 0 },
    };

    let updatedPipeline: FlowPipeline = {
      ...pipeline,
      nodes: [...pipeline.nodes, newNode],
      updatedAt: new Date().toISOString(),
    };

    if (lastNode) {
      updatedPipeline = addOrUpdateEdge(updatedPipeline, lastNode.id, newNode.id, 'Next Sequence');
    }

    onUpdatePipeline(updatedPipeline);

    // Immediately open the newly created query in the editor
    setTimeout(() => {
      onSelectNode(newNode);
    }, 80);
  };

  // Auto layout nodes horizontally in a sequence
  const handleAutoLayout = () => {
    const arrangedNodes = sortedNodes.map((node, idx) => ({
      ...node,
      position: {
        x: 80 + idx * 330,
        y: 160,
      },
    }));

    onUpdatePipeline({
      ...pipeline,
      nodes: arrangedNodes,
      updatedAt: new Date().toISOString(),
    });
  };

  // Fit all nodes into current viewport view
  const handleFitView = useCallback(() => {
    if (!containerRef.current || sortedNodes.length === 0) {
      setPan({ x: 60, y: 60 });
      setZoom(1);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const padding = 80;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    sortedNodes.forEach((n) => {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + 300); // 280 card width + margin
      maxY = Math.max(maxY, n.position.y + 260); // approx card height
    });

    // include add button
    maxX = Math.max(maxX, (sortedNodes[sortedNodes.length - 1]?.position.x || 0) + 600);

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    const availableWidth = Math.max(200, containerRect.width - padding * 2);
    const availableHeight = Math.max(200, containerRect.height - padding * 2);

    const scaleX = availableWidth / contentWidth;
    const scaleY = availableHeight / contentHeight;
    const newZoom = Math.min(1.4, Math.max(0.4, Math.min(scaleX, scaleY)));

    const newPanX = (containerRect.width - contentWidth * newZoom) / 2 - minX * newZoom;
    const newPanY = (containerRect.height - contentHeight * newZoom) / 2 - minY * newZoom;

    setZoom(Math.round(newZoom * 100) / 100);
    setPan({
      x: Math.round(newPanX),
      y: Math.round(newPanY),
    });
  }, [sortedNodes]);

  // Reorder node step
  const handleMoveOrder = (nodeId: string, direction: 'up' | 'down') => {
    const idx = sortedNodes.findIndex((n) => n.id === nodeId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === sortedNodes.length - 1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const current = sortedNodes[idx];
    const target = sortedNodes[targetIdx];

    const tempOrder = current.executionOrder;
    current.executionOrder = target.executionOrder;
    target.executionOrder = tempOrder;

    onUpdatePipeline({
      ...pipeline,
      nodes: [...pipeline.nodes],
      updatedAt: new Date().toISOString(),
    });
  };

  // Delete node
  const handleDeleteNode = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedNodes = pipeline.nodes.filter((n) => n.id !== nodeId);
    const updatedEdges = pipeline.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    onUpdatePipeline({
      ...pipeline,
      nodes: updatedNodes,
      edges: updatedEdges,
      updatedAt: new Date().toISOString(),
    });
  };

  // Duplicate node
  const handleDuplicateNode = (node: SQLNode, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextOrder = Math.max(...sortedNodes.map((n) => n.executionOrder)) + 1;
    const duplicated: SQLNode = {
      ...node,
      id: `node-${Date.now()}`,
      name: `${node.name} (Copy)`,
      executionOrder: nextOrder,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      nextNodeIds: [],
    };
    onUpdatePipeline({
      ...pipeline,
      nodes: [...pipeline.nodes, duplicated],
      updatedAt: new Date().toISOString(),
    });
  };

  // Toggle node enabled
  const handleToggleEnabled = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedNodes = pipeline.nodes.map((n) => (n.id === nodeId ? { ...n, enabled: !n.enabled } : n));
    onUpdatePipeline({
      ...pipeline,
      nodes: updatedNodes,
      updatedAt: new Date().toISOString(),
    });
  };

  // ==========================================
  // Mouse & Trackpad Navigation (Pan & Zoom)
  // ==========================================

  // Wheel listener for smooth 2-finger panning or Ctrl/Pinch zooming
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch or Ctrl + Wheel Zoom
        const rect = container.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        const zoomDelta = e.deltaY < 0 ? 1.08 : 0.92;
        setZoom((prevZoom) => {
          const nextZoom = Math.min(2.5, Math.max(0.25, prevZoom * zoomDelta));
          setPan((prevPan) => {
            const newPanX = cursorX - (cursorX - prevPan.x) * (nextZoom / prevZoom);
            const newPanY = cursorY - (cursorY - prevPan.y) * (nextZoom / prevZoom);
            return { x: newPanX, y: newPanY };
          });
          return nextZoom;
        });
      } else {
        // Standard mouse wheel or trackpad scroll = Pan
        setPan((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Canvas Background Mouse Down (Start Panning)
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // If clicking a card, node, or interactive element, do not pan canvas
    const target = e.target as HTMLElement;
    if (
      target.closest('[data-interactive="true"]') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('[id^="sql-node-"]')
    ) {
      return;
    }

    if (e.button === 0 || e.button === 1) {
      // Left or middle click on background
      setIsPanning(true);
      panStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialPanX: pan.x,
        initialPanY: pan.y,
      };
    }
  };

  // Node Mouse Down (Start Moving Node)
  const handleNodeMouseDown = (node: SQLNode, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('select') ||
      target.closest('input') ||
      target.closest('[data-interactive="true"]')
    ) {
      return;
    }

    e.stopPropagation();
    setDraggingNodeId(node.id);
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    dragNodeInitialPosRef.current = { x: node.position.x, y: node.position.y };
    draggedNodePosRef.current = { id: node.id, x: node.position.x, y: node.position.y };
    setDraggedNodePos({ id: node.id, x: node.position.x, y: node.position.y });
    isDraggingNodeRef.current = false;
    hasMovedNodeRef.current = false;

    if (dragSuppressTimerRef.current) {
      clearTimeout(dragSuppressTimerRef.current);
      dragSuppressTimerRef.current = null;
    }
  };

  // Auto-pan animation frame loop while dragging a node near canvas borders
  useEffect(() => {
    if (!draggingNodeId) {
      if (autoPanAnimIdRef.current) {
        cancelAnimationFrame(autoPanAnimIdRef.current);
        autoPanAnimIdRef.current = null;
      }
      autoPanVelocityRef.current = { vx: 0, vy: 0 };
      return;
    }

    const autoPanLoop = () => {
      const { vx, vy } = autoPanVelocityRef.current;
      if ((vx !== 0 || vy !== 0) && draggingNodeId && dragStartPosRef.current && dragNodeInitialPosRef.current) {
        // Pan canvas
        setPan((prev) => {
          const nextPan = { x: prev.x + vx, y: prev.y + vy };
          panRef.current = nextPan;
          return nextPan;
        });

        // Adjust dragStartPos so node keeps pace with moving canvas
        dragStartPosRef.current.x += vx;
        dragStartPosRef.current.y += vy;

        if (currentCursorPosRef.current) {
          const dx = currentCursorPosRef.current.clientX - dragStartPosRef.current.x;
          const dy = currentCursorPosRef.current.clientY - dragStartPosRef.current.y;
          const currentZoom = zoomRef.current || 1;
          const newX = Math.round(dragNodeInitialPosRef.current.x + dx / currentZoom);
          const newY = Math.round(dragNodeInitialPosRef.current.y + dy / currentZoom);

          draggedNodePosRef.current = { id: draggingNodeId, x: newX, y: newY };
          setDraggedNodePos({ id: draggingNodeId, x: newX, y: newY });
        }
      }
      autoPanAnimIdRef.current = requestAnimationFrame(autoPanLoop);
    };

    autoPanAnimIdRef.current = requestAnimationFrame(autoPanLoop);

    return () => {
      if (autoPanAnimIdRef.current) {
        cancelAnimationFrame(autoPanAnimIdRef.current);
        autoPanAnimIdRef.current = null;
      }
    };
  }, [draggingNodeId]);

  // Global Mouse Move & Mouse Up Listeners (Handles both canvas panning and node dragging seamlessly)
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      currentCursorPosRef.current = { clientX: e.clientX, clientY: e.clientY };

      // 1. Panning canvas background
      if (isPanning) {
        const dx = e.clientX - panStartRef.current.startX;
        const dy = e.clientY - panStartRef.current.startY;
        setPan({
          x: panStartRef.current.initialPanX + dx,
          y: panStartRef.current.initialPanY + dy,
        });
        return;
      }

      // 2. Dragging a node card
      if (draggingNodeId && dragStartPosRef.current && dragNodeInitialPosRef.current) {
        const dx = e.clientX - dragStartPosRef.current.x;
        const dy = e.clientY - dragStartPosRef.current.y;

        if (!hasMovedNodeRef.current && (Math.abs(dx) >= 3 || Math.abs(dy) >= 3)) {
          hasMovedNodeRef.current = true;
          isDraggingNodeRef.current = true;
        }

        if (!hasMovedNodeRef.current) return;

        // Calculate auto-pan velocity based on proximity to viewport edges
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const margin = 70;
          let vx = 0;
          let vy = 0;

          if (e.clientX < rect.left + margin) {
            vx = Math.min(24, Math.max(2, (rect.left + margin - e.clientX) * 0.35));
          } else if (e.clientX > rect.right - margin) {
            vx = -Math.min(24, Math.max(2, (e.clientX - (rect.right - margin)) * 0.35));
          }

          if (e.clientY < rect.top + margin) {
            vy = Math.min(24, Math.max(2, (rect.top + margin - e.clientY) * 0.35));
          } else if (e.clientY > rect.bottom - margin) {
            vy = -Math.min(24, Math.max(2, (e.clientY - (rect.bottom - margin)) * 0.35));
          }

          autoPanVelocityRef.current = { vx, vy };
        }

        const currentZoom = zoomRef.current || 1;
        const newX = Math.round(dragNodeInitialPosRef.current.x + dx / currentZoom);
        const newY = Math.round(dragNodeInitialPosRef.current.y + dy / currentZoom);

        draggedNodePosRef.current = { id: draggingNodeId, x: newX, y: newY };

        // Throttle UI position update using requestAnimationFrame for butter-smooth 60/120fps movement
        if (!rafDragIdRef.current) {
          rafDragIdRef.current = requestAnimationFrame(() => {
            rafDragIdRef.current = null;
            if (draggedNodePosRef.current) {
              setDraggedNodePos({ ...draggedNodePosRef.current });
            }
          });
        }
      }
    };

    const handleGlobalMouseUp = () => {
      autoPanVelocityRef.current = { vx: 0, vy: 0 };
      currentCursorPosRef.current = null;

      if (rafDragIdRef.current) {
        cancelAnimationFrame(rafDragIdRef.current);
        rafDragIdRef.current = null;
      }

      if (isPanning) {
        setIsPanning(false);
      }

      if (draggingNodeId) {
        const currentDraggedId = draggingNodeId;
        const finalPos = draggedNodePosRef.current;

        if (hasMovedNodeRef.current && finalPos) {
          lastDragEndTimeRef.current = Date.now();
          // Commit final position once at drag end
          const updatedNodes = pipelineRef.current.nodes.map((n) =>
            n.id === currentDraggedId ? { ...n, position: { x: finalPos.x, y: finalPos.y } } : n
          );
          onUpdatePipeline({
            ...pipelineRef.current,
            nodes: updatedNodes,
          });
        }

        setDraggingNodeId(null);
        setDraggedNodePos(null);
        draggedNodePosRef.current = null;
        dragStartPosRef.current = null;
        dragNodeInitialPosRef.current = null;

        if (dragSuppressTimerRef.current) clearTimeout(dragSuppressTimerRef.current);
        dragSuppressTimerRef.current = setTimeout(() => {
          isDraggingNodeRef.current = false;
          hasMovedNodeRef.current = false;
        }, 400);
      }
    };

    if (isPanning || draggingNodeId) {
      window.addEventListener('mousemove', handleGlobalMouseMove, { passive: true });
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isPanning, draggingNodeId, onUpdatePipeline]);

  // ==========================================
  // Touch & Finger Navigation (Touchscreens)
  // ==========================================

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const target = e.target as HTMLElement;

      // Check if touching a node
      const nodeEl = target.closest('[id^="sql-node-"]') as HTMLElement | null;
      if (nodeEl && !target.closest('button') && !target.closest('input')) {
        const nodeId = nodeEl.id.replace('sql-node-', '');
        const targetNode = pipeline.nodes.find((n) => n.id === nodeId);
        if (targetNode) {
          touchStateRef.current = {
            mode: 'node',
            startX: touch.clientX,
            startY: touch.clientY,
            initialPanX: pan.x,
            initialPanY: pan.y,
            initialDist: 0,
            initialZoom: zoom,
            centerPos: { x: 0, y: 0 },
            nodeId: targetNode.id,
            nodeInitialPos: { x: targetNode.position.x, y: targetNode.position.y },
          };
          setDraggingNodeId(targetNode.id);
          dragStartPosRef.current = { x: touch.clientX, y: touch.clientY };
          dragNodeInitialPosRef.current = { x: targetNode.position.x, y: targetNode.position.y };
          draggedNodePosRef.current = { id: targetNode.id, x: targetNode.position.x, y: targetNode.position.y };
          setDraggedNodePos({ id: targetNode.id, x: targetNode.position.x, y: targetNode.position.y });
          hasMovedNodeRef.current = false;
          isDraggingNodeRef.current = false;
          return;
        }
      }

      // Single finger on canvas background: Pan mode
      touchStateRef.current = {
        mode: 'pan',
        startX: touch.clientX,
        startY: touch.clientY,
        initialPanX: pan.x,
        initialPanY: pan.y,
        initialDist: 0,
        initialZoom: zoom,
        centerPos: { x: 0, y: 0 },
      };
      setIsPanning(true);
    } else if (e.touches.length === 2) {
      // Two finger pinch-to-zoom & pan
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;

      touchStateRef.current = {
        mode: 'pinch',
        startX: midX,
        startY: midY,
        initialPanX: pan.x,
        initialPanY: pan.y,
        initialDist: dist,
        initialZoom: zoom,
        centerPos: { x: midX, y: midY },
      };
      setIsPanning(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const tState = touchStateRef.current;
    if (tState.mode === 'none') return;

    if (tState.mode === 'pan' && e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - tState.startX;
      const dy = touch.clientY - tState.startY;
      setPan({
        x: tState.initialPanX + dx,
        y: tState.initialPanY + dy,
      });
    } else if (tState.mode === 'node' && e.touches.length === 1 && tState.nodeId && tState.nodeInitialPos) {
      const touch = e.touches[0];
      const dx = touch.clientX - tState.startX;
      const dy = touch.clientY - tState.startY;

      if (!hasMovedNodeRef.current && (Math.abs(dx) >= 3 || Math.abs(dy) >= 3)) {
        hasMovedNodeRef.current = true;
        isDraggingNodeRef.current = true;
      }

      if (!hasMovedNodeRef.current) return;

      const currentZoom = zoomRef.current || 1;
      const newX = Math.round(tState.nodeInitialPos.x + dx / currentZoom);
      const newY = Math.round(tState.nodeInitialPos.y + dy / currentZoom);

      draggedNodePosRef.current = { id: tState.nodeId, x: newX, y: newY };
      if (!rafDragIdRef.current) {
        rafDragIdRef.current = requestAnimationFrame(() => {
          rafDragIdRef.current = null;
          if (draggedNodePosRef.current) {
            setDraggedNodePos({ ...draggedNodePosRef.current });
          }
        });
      }
    } else if (tState.mode === 'pinch' && e.touches.length === 2 && tState.initialDist > 0) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const currentMidX = (t1.clientX + t2.clientX) / 2;
      const currentMidY = (t1.clientY + t2.clientY) / 2;

      const scale = newDist / tState.initialDist;
      const newZoom = Math.min(2.5, Math.max(0.25, tState.initialZoom * scale));

      const rect = containerRef.current?.getBoundingClientRect();
      const originX = tState.centerPos.x - (rect?.left || 0);
      const originY = tState.centerPos.y - (rect?.top || 0);

      const newPanX = originX - (originX - tState.initialPanX) * (newZoom / tState.initialZoom) + (currentMidX - tState.startX);
      const newPanY = originY - (originY - tState.initialPanY) * (newZoom / tState.initialZoom) + (currentMidY - tState.startY);

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    }
  };

  const handleTouchEnd = () => {
    if (rafDragIdRef.current) {
      cancelAnimationFrame(rafDragIdRef.current);
      rafDragIdRef.current = null;
    }

    if (touchStateRef.current.mode === 'node' && hasMovedNodeRef.current && draggedNodePosRef.current && touchStateRef.current.nodeId) {
      lastDragEndTimeRef.current = Date.now();
      const nodeId = touchStateRef.current.nodeId;
      const finalPos = draggedNodePosRef.current;

      const updatedNodes = pipelineRef.current.nodes.map((n) =>
        n.id === nodeId ? { ...n, position: { x: finalPos.x, y: finalPos.y } } : n
      );
      onUpdatePipeline({
        ...pipelineRef.current,
        nodes: updatedNodes,
      });

      if (dragSuppressTimerRef.current) clearTimeout(dragSuppressTimerRef.current);
      dragSuppressTimerRef.current = setTimeout(() => {
        isDraggingNodeRef.current = false;
        hasMovedNodeRef.current = false;
      }, 400);
    }

    touchStateRef.current.mode = 'none';
    setIsPanning(false);
    setDraggingNodeId(null);
    setDraggedNodePos(null);
    draggedNodePosRef.current = null;
  };

  // Node click handler
  const handleNodeCardClick = (node: SQLNode, e: React.MouseEvent) => {
    // If in connecting mode, click on target card completes edge connection
    if (connectingSourceId) {
      e.stopPropagation();
      e.preventDefault();
      if (connectingSourceId !== node.id) {
        handleCompleteConnection(connectingSourceId, node.id);
      } else {
        setConnectingSourceId(null);
      }
      return;
    }

    // If user dragged the card, do not open the modal
    const timeSinceDrag = Date.now() - (lastDragEndTimeRef.current || 0);
    if (isDraggingNodeRef.current || hasMovedNodeRef.current || timeSinceDrag < 400) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    onSelectNode(node);
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleCanvasMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`relative flex-1 h-full w-full bg-slate-50 overflow-hidden flex flex-col select-none no-scrollbar ${
        isPanning ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{ touchAction: 'none' }}
    >
      {/* Background Interactive Dot Grid (Moves seamlessly with Pan & Zoom) */}
      <div
        className="absolute inset-0 opacity-60 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)',
          backgroundPosition: `${pan.x}px ${pan.y}px`,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        }}
      />

      {/* Top Controls Bar - Mobile & Desktop Responsive */}
      <div className="relative z-20 min-h-14 py-2 bg-white/95 backdrop-blur border-b border-slate-200 px-3 sm:px-4 flex flex-wrap items-center justify-between gap-2 shrink-0 shadow-sm overflow-x-auto">
        {/* Pipeline Selector & Details */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="p-1.5 bg-[#fdf0f6] text-[#e20074] rounded-lg border border-[#f8b4d9] shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="relative">
              <select
                id="pipeline-switcher-select"
                value={pipeline.id}
                onChange={(e) => onSelectPipeline(e.target.value)}
                className="bg-white border border-slate-200 hover:border-[#e20074] text-slate-800 font-semibold text-xs rounded-md px-2.5 py-1.5 pr-7 focus:outline-none focus:border-[#e20074] shadow-sm transition-colors cursor-pointer max-w-[150px] sm:max-w-none truncate"
              >
                {allPipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.nodes.length} steps)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            id="new-pipeline-btn"
            onClick={onNewPipeline}
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm cursor-pointer shrink-0"
            title="Create new sequence flow"
          >
            <Plus className="w-3.5 h-3.5 text-[#e20074]" />
            <span className="hidden sm:inline">New Flow</span>
          </button>

          <div className="hidden sm:block h-4 w-px bg-slate-200" />

          {/* Execution Pipeline Meta */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-slate-500 font-medium">
            <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-mono text-[11px]">
              {sortedNodes.length} Query Steps
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Fit View Button */}
          <button
            type="button"
            id="fit-view-btn"
            onClick={handleFitView}
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs font-semibold shadow-xs transition-all border border-slate-200 hover:border-[#f8b4d9] cursor-pointer"
            title="Fit and center all query nodes into view"
          >
            <Focus className="w-3.5 h-3.5 text-[#e20074]" />
            <span className="hidden md:inline">Fit View</span>
          </button>

          {/* Auto Layout Button */}
          <button
            type="button"
            id="auto-layout-btn"
            onClick={handleAutoLayout}
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs font-semibold shadow-xs transition-all border border-slate-200 hover:border-[#f8b4d9] cursor-pointer"
            title="Auto organize query nodes in sequence"
          >
            <Grid className="w-3.5 h-3.5 text-[#e20074]" />
            <span className="hidden md:inline">Auto Layout</span>
          </button>

          {/* Manage Sequential Edges Button */}
          <button
            type="button"
            id="manage-edges-btn"
            onClick={() => {
              setEditingEdge(null);
              setIsEdgeModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white hover:bg-[#fdf0f6] text-slate-700 hover:text-[#c70066] rounded text-xs font-semibold shadow-xs transition-all border border-slate-200 hover:border-[#f8b4d9] cursor-pointer"
            title="Open Edge & Sequence Connection Manager"
          >
            <GitBranch className="w-3.5 h-3.5 text-[#e20074]" />
            <span className="hidden sm:inline">Edges</span>
          </button>

          <button
            type="button"
            id="add-node-header-btn"
            onClick={handleAddNode}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs font-semibold shadow-xs transition-all border border-slate-200 hover:border-[#f8b4d9] cursor-pointer"
            title="Add a new HANA query node"
          >
            <Plus className="w-3.5 h-3.5 text-[#e20074]" />
            <span>Add<span className="hidden sm:inline"> Query</span></span>
          </button>

          <div className="h-4 w-px bg-slate-200 mx-0.5 hidden sm:block" />

          <button
            type="button"
            id="run-pipeline-btn"
            onClick={onRunSimulation}
            className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Run<span className="hidden md:inline"> Pipeline</span></span>
          </button>

          <button
            type="button"
            id="export-pipeline-btn"
            onClick={onExport}
            className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 bg-[#e20074] hover:bg-[#c70066] text-white rounded text-xs font-semibold shadow-sm transition-all active:scale-95 border border-[#e20074] cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      {/* Circular Dependency / Cycle Warning Banner */}
      {cycleAnalysis.hasCycle && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-rose-500/10 border-b border-amber-300 px-6 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-950 z-20 shadow-xs backdrop-blur-xs">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-amber-500 text-white rounded-lg shadow-2xs shrink-0">
              <RefreshCw className="w-4 h-4 animate-spin" style={{ animationDuration: '8s' }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-900">Circular Dependency Cycle Detected:</span>
                <span className="font-mono text-[11px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-300 font-semibold">
                  {cycleAnalysis.cyclePaths[0]?.summary || 'Closed Loop Cycle'}
                </span>
              </div>
              <p className="text-[11px] text-amber-800/90 mt-0.5">
                Connected SQL queries form a closed loop. In SAP HANA execution, this triggers iterative loop cycles.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <button
              type="button"
              id="resolve-cycle-btn"
              onClick={handleBreakCycles}
              className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              title="Remove cyclic back-edges to restore a strict linear DAG"
            >
              <Repeat className="w-3.5 h-3.5 text-amber-600" />
              <span>Auto-Break Cycle</span>
            </button>

            <button
              type="button"
              id="simulate-cycle-btn"
              onClick={onRunSimulation}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Simulate Loop</span>
            </button>
          </div>
        </div>
      )}

      {/* Interactive Connecting Mode Notification Banner */}
      {connectingSourceId && (() => {
        const srcNode = pipeline.nodes.find((n) => n.id === connectingSourceId);
        return (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur-md text-white px-5 py-2.5 rounded-xl shadow-2xl flex items-center gap-3 text-xs border border-[#f8b4d9]/50 select-none animate-fadeIn">
            <span className="w-2.5 h-2.5 rounded-full bg-[#e20074] animate-ping shrink-0" />
            <span>
              <strong>Connecting Mode:</strong> Click any target query card to execute after{' '}
              <span className="text-[#f8b4d9] font-bold">Step #{srcNode?.executionOrder} ({srcNode?.name})</span>
            </span>
            <button
              type="button"
              onClick={() => setConnectingSourceId(null)}
              className="px-2.5 py-1 bg-white/20 hover:bg-white/30 text-white rounded text-xs font-semibold cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        );
      })()}

      {/* Infinite Canvas Viewport (Scrollbar-Free Navigation with Smooth Mouse/Finger Pan & Zoom) */}
      <div className="relative flex-1 w-full h-full overflow-hidden no-scrollbar">
        {/* Transform Layer for Pan & Zoom */}
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'auto',
          }}
        >
          {/* Render Connection Arrows between Sequence Steps based on DAG Edges */}
          <svg
            className="absolute inset-0 pointer-events-none w-full h-full z-0"
            style={{ overflow: 'visible' }}
          >
            <defs>
              <marker
                id="arrow-magenta"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#e20074" />
              </marker>
              <marker
                id="arrow-amber"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b" />
              </marker>
            </defs>

            {pipeline.edges.map((edge) => {
              const sourceNode = pipeline.nodes.find((n) => n.id === edge.source);
              const targetNode = pipeline.nodes.find((n) => n.id === edge.target);
              if (!sourceNode || !targetNode) return null;

              const isCyclicEdge = cycleAnalysis.cycleEdgeIds.includes(edge.id);

              const sourcePos =
                draggedNodePos && draggedNodePos.id === sourceNode.id
                  ? { x: draggedNodePos.x, y: draggedNodePos.y }
                  : sourceNode.position;
              const targetPos =
                draggedNodePos && draggedNodePos.id === targetNode.id
                  ? { x: draggedNodePos.x, y: draggedNodePos.y }
                  : targetNode.position;

              const startX = sourcePos.x + 280;
              const startY = sourcePos.y + 48;
              const endX = targetPos.x;
              const endY = targetPos.y + 48;

              const dx = Math.max(40, Math.abs(endX - startX) / 2);
              const cX1 = startX + dx;
              const cY1 = startY;
              const cX2 = endX - dx;
              const cY2 = endY;

              return (
                <g key={`edge-${edge.id}`}>
                  <path
                    d={`M ${startX} ${startY} C ${cX1} ${cY1}, ${cX2} ${cY2}, ${endX} ${endY}`}
                    fill="none"
                    stroke={isCyclicEdge ? '#f59e0b' : '#e20074'}
                    strokeWidth={isCyclicEdge ? '3' : '2.5'}
                    strokeDasharray={isCyclicEdge ? '4 4' : '6 3'}
                    className={`animate-flow-pulse ${isCyclicEdge ? 'opacity-100' : 'opacity-90'}`}
                    markerEnd={isCyclicEdge ? 'url(#arrow-amber)' : 'url(#arrow-magenta)'}
                  />
                </g>
              );
            })}
          </svg>

          {/* Interactive Edge Badges for Clicking, Editing & Deleting Edges */}
          {pipeline.edges.map((edge) => {
            const sourceNode = pipeline.nodes.find((n) => n.id === edge.source);
            const targetNode = pipeline.nodes.find((n) => n.id === edge.target);
            if (!sourceNode || !targetNode) return null;

            const isCyclicEdge = cycleAnalysis.cycleEdgeIds.includes(edge.id);

            const sourcePos =
              draggedNodePos && draggedNodePos.id === sourceNode.id
                ? { x: draggedNodePos.x, y: draggedNodePos.y }
                : sourceNode.position;
            const targetPos =
              draggedNodePos && draggedNodePos.id === targetNode.id
                ? { x: draggedNodePos.x, y: draggedNodePos.y }
                : targetNode.position;

            const startX = sourcePos.x + 280;
            const startY = sourcePos.y + 48;
            const endX = targetPos.x;
            const endY = targetPos.y + 48;
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2;

            return (
              <div
                key={`edge-badge-${edge.id}`}
                data-interactive="true"
                style={{
                  position: 'absolute',
                  left: `${midX}px`,
                  top: `${midY}px`,
                  transform: 'translate(-50%, -50%)',
                }}
                className={`z-20 group/edge flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-md text-[11px] font-mono transition-colors cursor-pointer select-none ${
                  isCyclicEdge
                    ? 'bg-amber-50 hover:bg-amber-100 border border-amber-400 text-amber-900 ring-2 ring-amber-200'
                    : 'bg-white hover:bg-[#fdf0f6] border border-[#f8b4d9] hover:border-[#e20074] text-slate-800'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingEdge(edge);
                  setIsEdgeModalOpen(true);
                }}
                title={
                  isCyclicEdge
                    ? 'Circular Dependency Edge: Creates a loop cycle. Click to edit or delete.'
                    : 'Click to edit or unlink this execution step sequence'
                }
              >
                {isCyclicEdge ? (
                  <RefreshCw className="w-3 h-3 text-amber-600 animate-spin" style={{ animationDuration: '6s' }} />
                ) : (
                  <GitBranch className="w-3 h-3 text-[#e20074]" />
                )}
                <span className={`font-bold ${isCyclicEdge ? 'text-amber-800' : 'text-[#c70066]'}`}>
                  #{sourceNode.executionOrder} ➔ #{targetNode.executionOrder}
                </span>
                {isCyclicEdge ? (
                  <span className="text-amber-700 font-semibold font-sans text-[10px] uppercase tracking-wider px-1 bg-amber-200/80 rounded">
                    Loop
                  </span>
                ) : edge.label ? (
                  <span className="text-slate-500 font-sans text-[10px] hidden sm:inline truncate max-w-[90px]">
                    ({edge.label})
                  </span>
                ) : null}
                <span className="opacity-0 group-hover/edge:opacity-100 flex items-center gap-1 transition-opacity border-l border-slate-200 pl-1 ml-0.5">
                  <Edit2 className="w-2.5 h-2.5 text-slate-500 hover:text-[#e20074]" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteEdge(edge.id);
                    }}
                    className="p-0.5 text-slate-400 hover:text-rose-600 rounded transition-colors"
                    title="Disconnect edge"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </span>
              </div>
            );
          })}

          {/* Render SQL Nodes */}
          {sortedNodes.map((node) => {
            const isValid = node.validationSummary ? node.validationSummary.isValid : true;
            const errorCount = node.validationSummary?.errors || 0;
            const isCurrentDragging = draggingNodeId === node.id;
            const isCyclicNode = cycleAnalysis.cycleNodeIds.includes(node.id);
            const outgoingEdges = pipeline.edges.filter((e) => e.source === node.id);

            const posX =
              draggedNodePos && draggedNodePos.id === node.id ? draggedNodePos.x : node.position.x;
            const posY =
              draggedNodePos && draggedNodePos.id === node.id ? draggedNodePos.y : node.position.y;

            return (
              <div
                key={node.id}
                id={`sql-node-${node.id}`}
                onMouseDown={(e) => handleNodeMouseDown(node, e)}
                onClick={(e) => handleNodeCardClick(node, e)}
                style={{
                  position: 'absolute',
                  left: `${posX}px`,
                  top: `${posY}px`,
                  width: '280px',
                  willChange: isCurrentDragging ? 'left, top' : 'auto',
                  transition: isCurrentDragging ? 'none' : undefined,
                }}
                className={`group bg-white hover:bg-slate-50/50 border rounded-xl shadow-md transition-[border-color,box-shadow,background-color,opacity] duration-150 select-none ${
                  isCurrentDragging
                    ? 'z-30 cursor-grabbing ring-2 ring-[#e20074] shadow-xl scale-[1.02] border-[#e20074]'
                    : isCyclicNode
                    ? 'z-10 cursor-grab border-amber-400 hover:border-amber-500 ring-2 ring-amber-200/80 shadow-amber-100 hover:shadow-lg'
                    : 'z-10 cursor-grab hover:border-[#e20074] hover:shadow-lg'
                } ${!node.enabled ? 'opacity-55 bg-slate-50' : ''} ${
                  node.status === 'running'
                    ? 'border-[#e20074] ring-2 ring-[#e20074] shadow-lg animate-pulse'
                    : node.status === 'success'
                    ? 'border-emerald-500 shadow-emerald-100'
                    : node.status === 'error'
                    ? 'border-rose-500 shadow-rose-100 ring-2 ring-rose-300'
                    : !isValid
                    ? 'border-rose-400 shadow-rose-100 ring-1 ring-rose-400'
                    : isCyclicNode
                    ? 'border-amber-400'
                    : 'border-slate-200'
                } ${
                  connectingSourceId === node.id ? 'ring-2 ring-[#e20074] border-[#e20074]' : ''
                }`}
              >
                {/* Left Input Port (Execution Predecessors connect here) */}
                <div
                  data-interactive="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (connectingSourceId && connectingSourceId !== node.id) {
                      handleCompleteConnection(connectingSourceId, node.id);
                    }
                  }}
                  style={{ top: '48px' }}
                  className={`absolute -left-2.5 -translate-y-1/2 w-5 h-5 rounded-full border-2 bg-white flex items-center justify-center transition-all z-20 ${
                    connectingSourceId && connectingSourceId !== node.id
                      ? 'border-[#e20074] ring-4 ring-[#fdf0f6] bg-[#fdf0f6] text-[#e20074] cursor-pointer animate-pulse scale-110'
                      : 'border-slate-300 text-slate-400'
                  }`}
                  title={
                    connectingSourceId && connectingSourceId !== node.id
                      ? `Click to connect selected step to execute Step #${node.executionOrder}`
                      : `Input Execution Port (Step #${node.executionOrder})`
                  }
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                </div>

                {/* Right Output Port (Create execution edge to next query) */}
                <button
                  data-interactive="true"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (connectingSourceId === node.id) {
                      setConnectingSourceId(null);
                    } else {
                      setConnectingSourceId(node.id);
                    }
                  }}
                  style={{ top: '48px' }}
                  className={`absolute -right-2.5 -translate-y-1/2 w-5 h-5 rounded-full border-2 bg-white flex items-center justify-center transition-all z-20 cursor-pointer ${
                    connectingSourceId === node.id
                      ? 'border-[#e20074] bg-[#e20074] text-white ring-4 ring-[#fdf0f6]'
                      : 'border-[#e20074] text-[#e20074] hover:bg-[#e20074] hover:text-white shadow-xs'
                  }`}
                  title={
                    connectingSourceId === node.id
                      ? 'Cancel connecting'
                      : `Connect Step #${node.executionOrder} to next execution step`
                  }
                >
                  <Plus className="w-3 h-3" />
                </button>

                {/* Node Card Header with Drag Handle */}
                <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 rounded-t-xl">
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600">
                      <GripVertical className="w-3.5 h-3.5 shrink-0" />
                    </span>

                    {/* Step Sequence Badge */}
                    <span className="px-1.5 py-0.5 bg-[#fdf0f6] text-[#c70066] font-mono text-[11px] font-bold rounded border border-[#f8b4d9]">
                      #{node.executionOrder}
                    </span>

                    {/* Inactive / Deactivated Badge */}
                    {!node.enabled && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-slate-200/90 text-slate-600 border border-slate-300 flex items-center gap-1 shrink-0"
                        title="This SQL statement is deactivated and bypassed in execution"
                      >
                        <Power className="w-2.5 h-2.5 text-slate-500" />
                        <span>OFF</span>
                      </span>
                    )}

                    {/* Cyclic Node Badge */}
                    {isCyclicNode && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-0.5 shrink-0"
                        title="This query is part of a circular dependency execution loop"
                      >
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" style={{ animationDuration: '6s' }} />
                        <span>Loop</span>
                      </span>
                    )}
                  </div>

                  {/* Header Status & Documentation Icon */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      data-interactive="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDocumentation(node);
                      }}
                      className="p-1 text-slate-400 hover:text-[#e20074] hover:bg-[#fdf0f6] rounded transition-colors"
                      title="Open Full Documentation"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                    </button>

                    {node.status === 'running' ? (
                      <span className="w-2 h-2 rounded-full bg-[#e20074] animate-ping" />
                    ) : node.status === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : node.status === 'error' ? (
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                    ) : !isValid ? (
                      <div className="flex items-center gap-0.5 text-rose-600 text-[10px] font-mono font-bold">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{errorCount}</span>
                      </div>
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    )}
                  </div>
                </div>

                {/* Node Card Body: Editable Name, Description & Content */}
                <div className="p-3.5 space-y-2.5">
                  {/* Card Title & Description */}
                  {editingCardId === node.id ? (
                    <div
                      data-interactive="true"
                      className="space-y-1.5 bg-slate-50 p-2 rounded-lg border border-[#f8b4d9]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={cardTitle}
                        onChange={(e) => setCardTitle(e.target.value)}
                        className="w-full text-xs font-bold text-slate-900 border border-slate-300 rounded px-1.5 py-0.5 bg-white outline-none focus:border-[#e20074]"
                        placeholder="Step title..."
                        autoFocus
                      />
                      <input
                        type="text"
                        value={cardDesc}
                        onChange={(e) => setCardDesc(e.target.value)}
                        className="w-full text-[11px] text-slate-600 border border-slate-300 rounded px-1.5 py-0.5 bg-white outline-none focus:border-[#e20074]"
                        placeholder="Description..."
                      />
                      <div className="flex items-center justify-end gap-1 pt-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCardId(null);
                          }}
                          className="px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 rounded"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const updatedNodes = pipeline.nodes.map((n) =>
                              n.id === node.id ? { ...n, name: cardTitle, description: cardDesc } : n
                            );
                            onUpdatePipeline({ ...pipeline, nodes: updatedNodes });
                            setEditingCardId(null);
                          }}
                          className="px-2 py-0.5 text-[10px] bg-[#e20074] text-white rounded font-semibold"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-1 group/title">
                        <h4 className="font-bold text-xs text-slate-900 leading-tight line-clamp-1">
                          {node.name}
                        </h4>
                        <button
                          type="button"
                          data-interactive="true"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCardId(node.id);
                            setCardTitle(node.name);
                            setCardDesc(node.description || '');
                          }}
                          className="opacity-0 group-hover/title:opacity-100 p-0.5 text-slate-400 hover:text-[#e20074] rounded transition-opacity"
                          title="Quick edit step title & description"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                        {node.description || 'SAP HANA query step'}
                      </p>
                    </div>
                  )}

                  {/* Schema / Table Targets */}
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-600 bg-slate-50 px-2 py-1 rounded border border-slate-100">
                    <Database className="w-3 h-3 text-[#e20074] shrink-0" />
                    <span className="truncate">
                      {node.targetSchema ? `"${node.targetSchema}".` : ''}
                      {node.targetTable ? `"${node.targetTable}"` : 'READ_ONLY_VIEW'}
                    </span>
                  </div>

                  {/* SQL Snippet Preview */}
                  <div className="bg-slate-900 text-slate-200 rounded p-2 text-[10px] font-mono relative overflow-hidden group/sql border border-slate-800">
                    <pre className="line-clamp-2 overflow-hidden leading-snug whitespace-pre-wrap font-mono">
                      {node.sqlContent.replace(/--.*$/gm, '').trim() || '-- Empty Query --'}
                    </pre>
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />
                    <button
                      type="button"
                      data-interactive="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectNode(node);
                      }}
                      className="absolute right-1 bottom-1 p-1 bg-slate-800 hover:bg-[#e20074] text-slate-200 hover:text-white rounded text-[10px] transition-colors flex items-center gap-1 cursor-pointer"
                      title="Open full size editor"
                    >
                      <Maximize2 className="w-3 h-3 text-[#e20074] group-hover/sql:text-white" />
                    </button>
                  </div>

                  {/* Execution Sequence & Outgoing Connections */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-[10px]">
                    <div className="flex items-center gap-1 overflow-hidden">
                      <span className="text-slate-400 font-mono text-[9px] uppercase">Next:</span>
                      {outgoingEdges.length > 0 ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          {outgoingEdges.map((edge) => {
                            const tgt = pipeline.nodes.find((n) => n.id === edge.target);
                            if (!tgt) return null;
                            return (
                              <span
                                key={edge.id}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#fdf0f6] text-[#c70066] border border-[#f8b4d9] rounded font-mono text-[10px]"
                              >
                                <span>➔ #{tgt.executionOrder}</span>
                                <button
                                  type="button"
                                  data-interactive="true"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteEdge(edge.id);
                                  }}
                                  className="hover:text-rose-600 font-bold ml-0.5 cursor-pointer"
                                  title="Unlink connection"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[10px]">End of flow</span>
                      )}
                    </div>

                    <button
                      type="button"
                      data-interactive="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (connectingSourceId === node.id) {
                          setConnectingSourceId(null);
                        } else {
                          setConnectingSourceId(node.id);
                        }
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors flex items-center gap-0.5 cursor-pointer ${
                        connectingSourceId === node.id
                          ? 'bg-[#e20074] text-white'
                          : 'text-[#e20074] hover:bg-[#fdf0f6]'
                      }`}
                      title="Create execution edge to next query"
                    >
                      <Plus className="w-2.5 h-2.5" />
                      <span>{connectingSourceId === node.id ? 'Connecting...' : 'Link'}</span>
                    </button>
                  </div>
                </div>

                {/* Node Quick Action Hover Toolbar */}
                <div
                  data-interactive="true"
                  className="px-3 py-1.5 bg-slate-50/90 border-t border-slate-100 rounded-b-xl flex items-center justify-between text-slate-500"
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveOrder(node.id, 'up');
                      }}
                      className="p-1 hover:text-slate-900 hover:bg-slate-200/60 rounded transition-colors"
                      title="Move step left/earlier"
                    >
                      <MoveUp className="w-3 h-3 -rotate-90" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveOrder(node.id, 'down');
                      }}
                      className="p-1 hover:text-slate-900 hover:bg-slate-200/60 rounded transition-colors"
                      title="Move step right/later"
                    >
                      <MoveDown className="w-3 h-3 -rotate-90" />
                    </button>
                    <div className="h-3 w-px bg-slate-200 mx-0.5" />
                    {/* Activate / Deactivate Switch */}
                    <button
                      type="button"
                      data-interactive="true"
                      id={`toggle-node-${node.id}`}
                      onClick={(e) => handleToggleEnabled(node.id, e)}
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-all cursor-pointer select-none ${
                        node.enabled
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-slate-200/90 hover:bg-slate-300 text-slate-600 border border-slate-300'
                      }`}
                      title={
                        node.enabled
                          ? 'Statement is Active. Click to deactivate (skip in simulation & execution)'
                          : 'Statement is Deactivated. Click to activate'
                      }
                    >
                      <div
                        className={`w-6 h-3.5 flex items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                          node.enabled ? 'bg-emerald-600' : 'bg-slate-400'
                        }`}
                      >
                        <div
                          className={`bg-white w-2.5 h-2.5 rounded-full shadow-xs transform transition-transform duration-200 ease-in-out ${
                            node.enabled ? 'translate-x-2.5' : 'translate-x-0'
                          }`}
                        />
                      </div>
                      <span className="text-[10px] font-bold font-mono tracking-tight">
                        {node.enabled ? 'ACTIVE' : 'OFF'}
                      </span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => handleDuplicateNode(node, e)}
                      className="p-1 hover:text-slate-900 hover:bg-slate-200/60 rounded transition-colors"
                      title="Duplicate node step"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteNode(node.id, e)}
                      className="p-1 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                      title="Delete step"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Append New Step Drop Zone Card */}
          {(() => {
            const maxNodeX = sortedNodes.length > 0 ? Math.max(...sortedNodes.map((n) => n.position.x)) : 80;
            const refNode = sortedNodes.find((n) => n.position.x === maxNodeX);
            const appendX = sortedNodes.length > 0 ? maxNodeX + 330 : 80;
            const appendY = refNode ? refNode.position.y : 160;

            return (
              <div
                data-interactive="true"
                style={{
                  left: `${appendX}px`,
                  top: `${appendY}px`,
                  width: '280px',
                  minHeight: '230px',
                }}
                onClick={handleAddNode}
                className="absolute border-2 border-dashed border-slate-300 hover:border-[#e20074] bg-white/80 hover:bg-[#fdf0f6]/40 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all group shadow-2xs hover:shadow-md select-none z-10"
                title="Add new SQL Query to sequence"
              >
                <div className="w-10 h-10 rounded-full bg-[#fdf0f6] border border-[#f8b4d9] flex items-center justify-center text-[#e20074] group-hover:scale-110 transition-transform mb-2">
                  <Plus className="w-5 h-5" />
                </div>
                <span className="font-semibold text-xs text-slate-800 group-hover:text-[#e20074] transition-colors">
                  + Add SQL Query Step
                </span>
                <span className="text-[11px] text-slate-500 mt-1 max-w-[200px] leading-snug">
                  Append a new analytical SELECT query to this pipeline
                </span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Floating Canvas Navigation & Zoom Overlay */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-white/95 backdrop-blur-md border border-slate-200 hover:border-slate-300 p-1.5 rounded-xl shadow-lg text-xs text-slate-700 transition-colors select-none">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 10) / 10))}
          className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-[#e20074] rounded-lg transition-colors cursor-pointer"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <span className="font-mono text-xs px-2 min-w-[48px] text-center text-[#e20074] font-bold select-none">
          {Math.round(zoom * 100)}%
        </span>

        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 10) / 10))}
          className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-[#e20074] rounded-lg transition-colors cursor-pointer"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-slate-200 mx-1" />

        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPan({ x: 60, y: 40 });
          }}
          className="px-2 py-1 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
          title="Reset Zoom to 100% and Center"
        >
          100%
        </button>

        <button
          type="button"
          onClick={handleFitView}
          className="px-2.5 py-1 bg-[#fdf0f6] hover:bg-[#fce4f0] text-[#c70066] border border-[#f8b4d9] rounded-md text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1"
          title="Fit all query cards on screen"
        >
          <Focus className="w-3 h-3 text-[#e20074]" />
          <span>Fit</span>
        </button>
      </div>

      {/* Floating Canvas Navigation Helper Hint */}
      <div className="absolute bottom-5 left-5 z-20 hidden md:flex items-center gap-2 px-3 py-1.5 bg-white/90 backdrop-blur-md border border-slate-200 rounded-xl shadow-md text-[11px] text-slate-600 select-none pointer-events-none">
        <Hand className="w-3.5 h-3.5 text-[#e20074]" />
        <span>
          <strong>Board Navigation:</strong> Drag canvas with mouse / finger to pan • Scroll / Pinch to zoom
        </span>
      </div>

      {/* Edge Editing & Creation Modal */}
      <EdgeEditModal
        edge={editingEdge}
        pipeline={pipeline}
        isOpen={isEdgeModalOpen}
        onClose={() => {
          setIsEdgeModalOpen(false);
          setEditingEdge(null);
        }}
        onSaveEdge={handleSaveEdge}
        onDeleteEdge={handleDeleteEdge}
      />
    </div>
  );
};

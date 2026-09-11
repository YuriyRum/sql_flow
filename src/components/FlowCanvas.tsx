import React, { useState, useRef, useEffect } from 'react';
import { FlowPipeline, SQLNode, QueryType } from '../types';
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
  ZoomOut
} from 'lucide-react';

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
  const [zoom, setZoom] = useState(1);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardTitle, setCardTitle] = useState('');
  const [cardDesc, setCardDesc] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const hasMovedRef = useRef<boolean>(false);
  const lastDragEndTimeRef = useRef<number>(0);
  const dragSuppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sorted nodes by execution order
  const sortedNodes = [...pipeline.nodes].sort((a, b) => a.executionOrder - b.executionOrder);

  // Add new node to the pipeline sequence
  const handleAddNode = () => {
    const nextOrder = sortedNodes.length > 0 ? Math.max(...sortedNodes.map((n) => n.executionOrder)) + 1 : 1;
    const lastNode = sortedNodes[sortedNodes.length - 1];
    const newX = lastNode ? lastNode.position.x + 320 : 80;
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

    // Update nodes immutably
    const updatedNodes = pipeline.nodes.map((n) =>
      n.id === lastNode?.id ? { ...n, nextNodeIds: [...(n.nextNodeIds || []), newNode.id] } : { ...n }
    );
    updatedNodes.push(newNode);

    // Update edges
    const newEdges = [...pipeline.edges];
    if (lastNode) {
      newEdges.push({
        id: `e-${lastNode.id}-${newNode.id}`,
        source: lastNode.id,
        target: newNode.id,
        label: 'Next Sequence',
      });
    }

    onUpdatePipeline({
      ...pipeline,
      nodes: updatedNodes,
      edges: newEdges,
      updatedAt: new Date().toISOString(),
    });

    // Immediately open the newly created query in the editor so the user can edit its title, description, and SQL query!
    setTimeout(() => {
      onSelectNode(newNode);
    }, 80);
  };

  // Auto layout nodes horizontally in a sequence
  const handleAutoLayout = () => {
    const arrangedNodes = sortedNodes.map((node, idx) => ({
      ...node,
      position: {
        x: 80 + idx * 320,
        y: 160,
      },
    }));

    onUpdatePipeline({
      ...pipeline,
      nodes: arrangedNodes,
      updatedAt: new Date().toISOString(),
    });
  };

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

  // Mouse Dragging handlers for Canvas Nodes
  const handleMouseDown = (node: SQLNode, e: React.MouseEvent) => {
    // Only drag on primary left click
    if (e.button !== 0) return;
    // Don't drag if clicking buttons, select inputs, or interactive controls
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('select') || target.closest('input')) {
      return;
    }

    setDraggingNodeId(node.id);
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;
    hasMovedRef.current = false;
    if (dragSuppressTimerRef.current) {
      clearTimeout(dragSuppressTimerRef.current);
      dragSuppressTimerRef.current = null;
    }

    setDragOffset({
      x: e.clientX - node.position.x * zoom,
      y: e.clientY - node.position.y * zoom,
    });
  };

  // Global window listeners for drag & drop to guarantee smooth tracking & zero accidental open
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!draggingNodeId || !dragStartPosRef.current) return;

      const dx = Math.abs(e.clientX - dragStartPosRef.current.x);
      const dy = Math.abs(e.clientY - dragStartPosRef.current.y);

      // As soon as pointer moves >= 3px, mark as active drag
      if (!hasMovedRef.current && (dx >= 3 || dy >= 3)) {
        hasMovedRef.current = true;
        isDraggingRef.current = true;
      }

      if (!hasMovedRef.current) return;

      const newX = (e.clientX - dragOffset.x) / zoom;
      const newY = (e.clientY - dragOffset.y) / zoom;

      const updatedNodes = pipeline.nodes.map((n) =>
        n.id === draggingNodeId
          ? { ...n, position: { x: Math.max(20, Math.round(newX)), y: Math.max(20, Math.round(newY)) } }
          : n
      );

      onUpdatePipeline({
        ...pipeline,
        nodes: updatedNodes,
      });
    };

    const handleGlobalMouseUp = () => {
      if (draggingNodeId) {
        if (hasMovedRef.current) {
          lastDragEndTimeRef.current = Date.now();
        }
        setDraggingNodeId(null);
        dragStartPosRef.current = null;

        // Keep drag suppression active so any trailing click is completely ignored
        if (dragSuppressTimerRef.current) clearTimeout(dragSuppressTimerRef.current);
        dragSuppressTimerRef.current = setTimeout(() => {
          isDraggingRef.current = false;
          hasMovedRef.current = false;
        }, 500);
      }
    };

    if (draggingNodeId) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingNodeId, dragOffset, zoom, pipeline, onUpdatePipeline]);

  const handleMouseMove = (e: React.MouseEvent) => {
    // Fallback if needed, handled globally by useEffect
    if (!draggingNodeId || !dragStartPosRef.current) return;
    const dx = Math.abs(e.clientX - dragStartPosRef.current.x);
    const dy = Math.abs(e.clientY - dragStartPosRef.current.y);
    if (!hasMovedRef.current && (dx >= 3 || dy >= 3)) {
      hasMovedRef.current = true;
      isDraggingRef.current = true;
    }
  };

  const handleMouseUp = () => {
    if (draggingNodeId) {
      if (hasMovedRef.current) {
        lastDragEndTimeRef.current = Date.now();
      }
      setDraggingNodeId(null);
      dragStartPosRef.current = null;
      if (dragSuppressTimerRef.current) clearTimeout(dragSuppressTimerRef.current);
      dragSuppressTimerRef.current = setTimeout(() => {
        isDraggingRef.current = false;
        hasMovedRef.current = false;
      }, 500);
    }
  };

  const handleNodeCardClick = (node: SQLNode, e: React.MouseEvent) => {
    // If user dragged the card, do not open the modal under any circumstance!
    const timeSinceDrag = Date.now() - (lastDragEndTimeRef.current || 0);
    if (isDraggingRef.current || hasMovedRef.current || timeSinceDrag < 500) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    onSelectNode(node);
  };

  const getBadgeColorForType = (type: QueryType) => {
    switch (type) {
      case 'DDL':
        return 'bg-sky-50 text-sky-700 border-sky-200';
      case 'UPSERT':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'TRANSFORM':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'SQLSCRIPT':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'AGGREGATION':
        return 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200';
      default:
        return 'bg-[#fdf0f6] text-[#c70066] border-[#f8b4d9]';
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="relative flex-1 h-full w-full bg-slate-50 overflow-hidden flex flex-col select-none"
    >
      {/* Background Dot Grid */}
      <div
        className="absolute inset-0 opacity-60 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Top Controls Bar */}
      <div className="relative z-20 h-14 bg-white/95 backdrop-blur border-b border-slate-200 px-4 flex items-center justify-between shrink-0 shadow-sm">
        {/* Pipeline Selector & Details */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#fdf0f6] text-[#e20074] rounded-lg border border-[#f8b4d9]">
              <Layers className="w-4 h-4" />
            </div>
            <div className="relative">
              <select
                id="pipeline-switcher-select"
                value={pipeline.id}
                onChange={(e) => onSelectPipeline(e.target.value)}
                className="bg-white border border-slate-200 hover:border-[#e20074] text-slate-800 font-semibold text-xs rounded-md px-3 py-1.5 pr-8 focus:outline-none focus:border-[#e20074] shadow-sm transition-colors"
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
            className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm"
            title="Create new sequence flow"
          >
            <Plus className="w-3.5 h-3.5 text-[#e20074]" />
            <span className="hidden sm:inline">New Flow</span>
          </button>

          <div className="h-4 w-px bg-slate-200 mx-1 hidden md:block" />

          {/* Quick Metrics */}
          <div className="hidden lg:flex items-center gap-4 text-xs font-mono text-slate-500">
            <span>
              Queries: <strong className="text-slate-800">{pipeline.nodes.length}</strong>
            </span>
            <span>
              Engine: <strong className="text-[#c70066] font-semibold">{pipeline.targetHanaVersion || 'SAP HANA Cloud'}</strong>
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            id="auto-layout-btn"
            onClick={handleAutoLayout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs font-medium transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm"
            title="Auto align nodes into a clear horizontal sequence"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#e20074]" />
            <span className="hidden md:inline">Auto Sequence</span>
          </button>

          <button
            type="button"
            id="add-node-btn"
            onClick={handleAddNode}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-800 rounded text-xs font-medium transition-colors border border-slate-200 hover:border-[#e20074] shadow-sm"
          >
            <Plus className="w-4 h-4 text-[#e20074]" />
            <span>Add SQL Query</span>
          </button>

          <button
            type="button"
            id="run-pipeline-btn"
            onClick={onRunSimulation}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shadow-sm transition-all active:scale-95"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Run Pipeline</span>
          </button>

          <button
            type="button"
            id="export-pipeline-btn"
            onClick={onExport}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#e20074] hover:bg-[#c70066] text-white rounded text-xs font-semibold shadow-sm transition-all active:scale-95 border border-[#e20074]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Interactive Canvas Workspace Viewport (Remains full size; does not shrink or create a mini window) */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-auto bg-slate-100 select-none"
      >
        {/* Sizing Container for Zoomed Area */}
        <div
          style={{
            width: `${Math.max(3800, (sortedNodes.length + 3) * 360) * zoom}px`,
            height: `${2400 * zoom}px`,
            position: 'relative',
          }}
        >
          {/* Scaled Flow Graph Elements Layer */}
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
              width: `${Math.max(3800, (sortedNodes.length + 3) * 360)}px`,
              height: '2400px',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
            className="p-8"
          >
            {/* Render Connection Arrows between Sequence Steps */}
        <svg
          className="absolute inset-0 pointer-events-none w-[4000px] h-[3000px] z-0"
          style={{ minWidth: '4000px', minHeight: '3000px' }}
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
          </defs>

          {sortedNodes.map((node, i) => {
            if (i >= sortedNodes.length - 1) return null;
            const nextNode = sortedNodes[i + 1];

            const startX = node.position.x + 280;
            const startY = node.position.y + 110;
            const endX = nextNode.position.x;
            const endY = nextNode.position.y + 110;

            const cX1 = startX + (endX - startX) / 2;
            const cY1 = startY;
            const cX2 = startX + (endX - startX) / 2;
            const cY2 = endY;

            return (
              <g key={`edge-${node.id}-${nextNode.id}`}>
                <path
                  d={`M ${startX} ${startY} C ${cX1} ${cY1}, ${cX2} ${cY2}, ${endX} ${endY}`}
                  fill="none"
                  stroke="#e20074"
                  strokeWidth="2"
                  strokeDasharray="6 3"
                  className="animate-flow-pulse opacity-85"
                  markerEnd="url(#arrow-magenta)"
                />
              </g>
            );
          })}
        </svg>

        {/* Render SQL Nodes */}
        {sortedNodes.map((node) => {
          const isValid = node.validationSummary ? node.validationSummary.isValid : true;
          const errorCount = node.validationSummary?.errors || 0;
          const isCurrentDragging = draggingNodeId === node.id;

          return (
            <div
              key={node.id}
              id={`sql-node-${node.id}`}
              onMouseDown={(e) => handleMouseDown(node, e)}
              onClick={(e) => handleNodeCardClick(node, e)}
              style={{
                position: 'absolute',
                left: `${node.position.x}px`,
                top: `${node.position.y}px`,
                width: '280px',
              }}
              className={`group bg-white hover:bg-slate-50/50 border rounded-xl shadow-md transition-all duration-150 select-none ${
                isCurrentDragging
                  ? 'z-30 cursor-grabbing ring-2 ring-[#e20074] shadow-xl scale-[1.02] border-[#e20074]'
                  : 'z-10 cursor-grab hover:border-[#e20074] hover:shadow-lg'
              } ${
                !node.enabled
                  ? 'opacity-50 border-slate-200'
                  : !isValid
                  ? 'border-rose-400 shadow-rose-100 ring-1 ring-rose-400'
                  : 'border-slate-200'
              }`}
            >
              {/* Node Card Header with Drag Handle */}
              <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 rounded-t-xl">
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <span title="Drag to reposition step" className="inline-flex cursor-grab active:cursor-grabbing">
                    <GripVertical className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#e20074] shrink-0 transition-colors" />
                  </span>
                  <span className="px-1.5 py-0.5 bg-[#fdf0f6] text-[#c70066] font-mono text-[11px] font-bold rounded border border-[#f8b4d9] shrink-0">
                    #{node.executionOrder}
                  </span>
                  <span
                    className={`px-2 py-0.5 font-mono text-[10px] font-semibold uppercase rounded-full border shrink-0 ${getBadgeColorForType(
                      node.queryType
                    )}`}
                  >
                    {node.queryType}
                  </span>
                </div>

                {/* Status & Documentation Indicator */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Special Documentation Button */}
                  <button
                    type="button"
                    id={`card-doc-btn-${node.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDocumentation(node);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 bg-[#fdf0f6] hover:bg-[#fce4f0] text-[#c70066] border border-[#f8b4d9] hover:border-[#e20074] rounded text-[10px] font-semibold transition-all shadow-2xs cursor-pointer"
                    title="Open Full Screen Technical Documentation"
                  >
                    <BookOpen className="w-3 h-3 text-[#e20074]" />
                    <span>Docs</span>
                  </button>

                  {isValid ? (
                    <span title="Valid HANA SQL Syntax">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-300 rounded text-[10px] font-bold">
                      <AlertCircle className="w-3 h-3 text-rose-600" />
                      <span>{errorCount}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Node Card Content */}
              <div className="p-3.5 space-y-2.5">
                {editingCardId === node.id ? (
                  /* Inline Edit Mode for Title & Description */
                  <div
                    className="space-y-2 p-2 bg-[#fdf0f6]/50 rounded-lg border border-[#f8b4d9]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                        Step Title
                      </label>
                      <input
                        type="text"
                        value={cardTitle}
                        onChange={(e) => setCardTitle(e.target.value)}
                        className="w-full text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded px-2 py-1 outline-none focus:border-[#e20074]"
                        placeholder="Step title..."
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                        Description
                      </label>
                      <textarea
                        rows={2}
                        value={cardDesc}
                        onChange={(e) => setCardDesc(e.target.value)}
                        className="w-full text-[11px] text-slate-700 bg-white border border-slate-300 rounded px-2 py-1 outline-none focus:border-[#e20074] resize-none"
                        placeholder="Transformation purpose..."
                      />
                    </div>
                    <div className="flex items-center justify-end gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setEditingCardId(null)}
                        className="px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200 rounded"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updatedNodes = pipeline.nodes.map((n) =>
                            n.id === node.id ? { ...n, name: cardTitle, description: cardDesc } : n
                          );
                          onUpdatePipeline({
                            ...pipeline,
                            nodes: updatedNodes,
                            updatedAt: new Date().toISOString(),
                          });
                          setEditingCardId(null);
                        }}
                        className="px-2.5 py-0.5 text-[11px] font-semibold bg-[#e20074] hover:bg-[#c70066] text-white rounded shadow-2xs"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Standard View Mode */
                  <div className="flex items-start justify-between gap-1 group/header">
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-semibold text-slate-900 group-hover:text-[#e20074] transition-colors line-clamp-1">
                        {node.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 line-clamp-2 mt-0.5 leading-snug">
                        {node.description || 'SAP HANA SQL query transformation step'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCardId(node.id);
                        setCardTitle(node.name);
                        setCardDesc(node.description || '');
                      }}
                      className="p-1 text-slate-400 hover:text-[#e20074] hover:bg-[#fdf0f6] rounded transition-colors shrink-0"
                      title="Edit Title & Description"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Target Table / Schema */}
                {node.targetTable && (
                  <div className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                    <Database className="w-3 h-3 shrink-0" />
                    <span className="truncate">
                      {node.targetSchema ? `"${node.targetSchema}"."${node.targetTable}"` : node.targetTable}
                    </span>
                  </div>
                )}

                {/* SQL Code Snippet Preview */}
                <div className="p-2 bg-slate-50 rounded border border-slate-200 text-[10px] font-mono text-slate-600 line-clamp-3 leading-tight overflow-hidden">
                  {node.sqlContent}
                </div>

                {/* Actions on Node */}
                <div className="space-y-1 pt-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const timeSinceDrag = Date.now() - (lastDragEndTimeRef.current || 0);
                      if (isDraggingRef.current || hasMovedRef.current || timeSinceDrag < 500) {
                        e.preventDefault();
                        return;
                      }
                      onSelectNode(node);
                    }}
                    className="w-full flex items-center justify-between text-[11px] text-slate-600 hover:text-[#e20074] p-1.5 rounded hover:bg-[#fdf0f6]/60 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-1 font-medium">
                      <Code2 className="w-3.5 h-3.5 text-[#e20074]" />
                      <span>Edit HANA SQL Query</span>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#e20074] opacity-60 group-hover:opacity-100 transition-opacity" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDocumentation(node);
                    }}
                    className="w-full flex items-center justify-between text-[11px] text-[#c70066] hover:text-[#99004f] p-1.5 rounded bg-[#fdf0f6]/40 hover:bg-[#fdf0f6] border border-[#f8b4d9]/50 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-1 font-medium">
                      <BookOpen className="w-3.5 h-3.5 text-[#e20074]" />
                      <span>Full Screen Documentation</span>
                    </span>
                    <Maximize2 className="w-3 h-3 text-[#e20074] opacity-70" />
                  </button>
                </div>
              </div>

              {/* Node Quick Action Hover Toolbar */}
              <div className="px-3 py-1.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-slate-500 opacity-90 group-hover:opacity-100 rounded-b-xl">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => handleMoveOrder(node.id, 'up')}
                    className="p-1 hover:bg-slate-200 rounded hover:text-slate-800 transition-colors"
                    title="Move earlier in sequence"
                  >
                    <MoveUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleMoveOrder(node.id, 'down')}
                    className="p-1 hover:bg-slate-200 rounded hover:text-slate-800 transition-colors"
                    title="Move later in sequence"
                  >
                    <MoveDown className="w-3 h-3" />
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => handleDuplicateNode(node, e)}
                    className="p-1 hover:bg-slate-200 rounded hover:text-slate-800 transition-colors"
                    title="Duplicate query node"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteNode(node.id, e)}
                    className="p-1 hover:bg-rose-100 hover:text-rose-700 rounded transition-colors"
                    title="Delete node"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Canvas Step: "+ Add SQL Query Step" placeholder card */}
        <div
          style={{
            left: `${sortedNodes.length > 0 ? sortedNodes[sortedNodes.length - 1].position.x + 320 : 80}px`,
            top: `${sortedNodes.length > 0 ? sortedNodes[sortedNodes.length - 1].position.y : 160}px`,
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
          </div>
        </div>
      </div>

      {/* Floating Canvas Zoom & Info Overlay */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-1 bg-white/95 backdrop-blur-md border border-slate-200 hover:border-slate-300 p-1.5 rounded-xl shadow-lg text-xs text-slate-700 transition-colors">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}
          className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-[#e20074] rounded-lg transition-colors cursor-pointer"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="font-mono text-xs px-2 min-w-[50px] text-center text-[#e20074] font-bold select-none">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2.0, Math.round((z + 0.1) * 10) / 10))}
          className="p-1.5 hover:bg-slate-100 text-slate-700 hover:text-[#e20074] rounded-lg transition-colors cursor-pointer"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="h-4 w-px bg-slate-200 mx-1" />
        <button
          type="button"
          onClick={() => setZoom(1)}
          className="px-2.5 py-1 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
          title="Reset Zoom to 100%"
        >
          100%
        </button>
      </div>
    </div>
  );
};

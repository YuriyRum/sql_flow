import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Filter,
  Link2,
  Database,
  ArrowRight,
  Search,
  Info,
  Copy,
  Check,
  PanelRightClose,
  PanelRightOpen,
  Workflow,
} from 'lucide-react';
import { parseSqlTableGraph, ParsedTableGraph } from '../utils/sqlTableGraphParser';

interface TableDependencyGraphScreenProps {
  sql: string;
  onClose: () => void;
}

export const TableDependencyGraphScreen: React.FC<TableDependencyGraphScreenProps> = ({
  sql,
  onClose,
}) => {
  const [currentSql, setCurrentSql] = useState<string>(sql);
  const [parsedGraph, setParsedGraph] = useState<ParsedTableGraph>(() => parseSqlTableGraph(sql));
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showInspector, setShowInspector] = useState<boolean>(true);
  const [copiedEdgeId, setCopiedEdgeId] = useState<string | null>(null);
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);

  // Pan & Zoom State
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 80, y: 60 });
  const [zoom, setZoom] = useState<number>(1);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ startX: number; startY: number; initialPanX: number; initialPanY: number }>({
    startX: 0,
    startY: 0,
    initialPanX: 80,
    initialPanY: 60,
  });

  // Node Dragging State
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStartPosRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Parse SQL into Graph when SQL changes
  useEffect(() => {
    const graph = parseSqlTableGraph(currentSql);
    setParsedGraph(graph);

    // Initialize positions
    const posMap = new Map<string, { x: number; y: number }>();
    graph.nodes.forEach((n) => {
      posMap.set(n.id, { x: n.x ?? 100, y: n.y ?? 100 });
    });
    setNodePositions(posMap);

    if (graph.nodes.length > 0 && !selectedNodeId) {
      setSelectedNodeId(graph.nodes[0].id);
    }
  }, [currentSql]);

  // Sync external SQL changes if any
  useEffect(() => {
    if (sql !== currentSql) {
      setCurrentSql(sql);
    }
  }, [sql]);

  // Keyboard escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Zoom controls
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.3, Number((z - 0.15).toFixed(2))));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 80, y: 60 });
  };

  const handleFitToScreen = () => {
    if (parsedGraph.nodes.length === 0 || !containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    parsedGraph.nodes.forEach((n) => {
      const pos = nodePositions.get(n.id) || { x: n.x || 100, y: n.y || 100 };
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x + 320);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y + 240);
    });

    const graphWidth = maxX - minX + 160;
    const graphHeight = maxY - minY + 160;

    const scaleX = clientWidth / graphWidth;
    const scaleY = clientHeight / graphHeight;
    const newZoom = Math.min(1.2, Math.max(0.4, Math.min(scaleX, scaleY)));

    setZoom(Number(newZoom.toFixed(2)));
    setPan({
      x: (clientWidth - (maxX - minX) * newZoom) / 2 - minX * newZoom,
      y: (clientHeight - (maxY - minY) * newZoom) / 2 - minY * newZoom,
    });
  };

  // Pan handlers
  const handleMouseDownBackground = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Only if clicking directly on background
    if ((e.target as HTMLElement).closest('.graph-node') || (e.target as HTMLElement).closest('.edge-pill')) {
      return;
    }
    setIsPanning(true);
    panStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialPanX: pan.x,
      initialPanY: pan.y,
    };
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        const dx = e.clientX - panStartRef.current.startX;
        const dy = e.clientY - panStartRef.current.startY;
        setPan({
          x: panStartRef.current.initialPanX + dx,
          y: panStartRef.current.initialPanY + dy,
        });
      } else if (draggingNodeId && dragStartPosRef.current) {
        const dx = (e.clientX - dragStartPosRef.current.startX) / zoom;
        const dy = (e.clientY - dragStartPosRef.current.startY) / zoom;
        const newX = dragStartPosRef.current.initialX + dx;
        const newY = dragStartPosRef.current.initialY + dy;

        setNodePositions((prev) => {
          const next = new Map(prev);
          next.set(draggingNodeId, { x: newX, y: newY });
          return next;
        });
      }
    },
    [isPanning, draggingNodeId, zoom]
  );

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
    dragStartPosRef.current = null;
  };

  // Node drag start
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);

    const currentPos = nodePositions.get(nodeId) || { x: 100, y: 100 };
    setDraggingNodeId(nodeId);
    dragStartPosRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: currentPos.x,
      initialY: currentPos.y,
    };
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 1.08;
    const newZoom = e.deltaY < 0 ? Math.min(2.0, zoom * zoomFactor) : Math.max(0.3, zoom / zoomFactor);
    setZoom(Number(newZoom.toFixed(2)));
  };

  // Selected Node Details
  const selectedNode = useMemo(() => {
    return parsedGraph.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [parsedGraph.nodes, selectedNodeId]);

  // Selected Edge Details
  const selectedEdge = useMemo(() => {
    return parsedGraph.edges.find((e) => e.id === selectedEdgeId) || null;
  }, [parsedGraph.edges, selectedEdgeId]);

  // Filtered nodes by search
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return parsedGraph.nodes;
    const q = searchQuery.toLowerCase();
    return parsedGraph.nodes.filter(
      (n) =>
        n.tableName.toLowerCase().includes(q) ||
        n.alias.toLowerCase().includes(q) ||
        n.whereConditions.some((w) => w.toLowerCase().includes(q)) ||
        n.columns.some((c) => c.toLowerCase().includes(q))
    );
  }, [parsedGraph.nodes, searchQuery]);

  const handleCopyText = (text: string, type: 'node' | 'edge', id: string) => {
    navigator.clipboard.writeText(text);
    if (type === 'node') {
      setCopiedNodeId(id);
      setTimeout(() => setCopiedNodeId(null), 1500);
    } else {
      setCopiedEdgeId(id);
      setTimeout(() => setCopiedEdgeId(null), 1500);
    }
  };

  // Calculate SVG connector paths for edges
  const renderEdgePaths = () => {
    return parsedGraph.edges.map((edge) => {
      const srcPos = nodePositions.get(edge.sourceId) || { x: 100, y: 100 };
      const tgtPos = nodePositions.get(edge.targetId) || { x: 500, y: 100 };

      // Node dimensions
      const nodeWidth = 320;
      const nodeHeight = 210;

      // Source anchor (Right side center of source node)
      const x1 = srcPos.x + nodeWidth;
      const y1 = srcPos.y + nodeHeight / 2;

      // Target anchor (Left side center of target node)
      const x2 = tgtPos.x;
      const y2 = tgtPos.y + nodeHeight / 2;

      // Midpoint for placing the ON condition badge
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      // Cubic bezier control points
      const dx = Math.abs(x2 - x1);
      const cx1 = x1 + Math.max(50, dx * 0.45);
      const cy1 = y1;
      const cx2 = x2 - Math.max(50, dx * 0.45);
      const cy2 = y2;

      const pathData = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
      const isSelected = selectedEdgeId === edge.id;

      // Color coding by join type
      const isLeft = edge.joinType.includes('LEFT');
      const isRight = edge.joinType.includes('RIGHT');
      const isFull = edge.joinType.includes('FULL');
      const strokeColor = isSelected
        ? '#e20074'
        : isLeft
        ? '#3b82f6'
        : isRight
        ? '#8b5cf6'
        : isFull
        ? '#f59e0b'
        : '#10b981';

      return (
        <g key={edge.id} className="cursor-pointer" onClick={() => {
          setSelectedEdgeId(edge.id);
          setSelectedNodeId(null);
        }}>
          {/* Edge line halo for easy click */}
          <path
            d={pathData}
            fill="none"
            stroke="transparent"
            strokeWidth={24}
            className="hover:stroke-slate-200/50 transition-colors"
          />

          {/* Actual Connector Curve */}
          <path
            d={pathData}
            fill="none"
            stroke={strokeColor}
            strokeWidth={isSelected ? 3 : 2}
            strokeDasharray={edge.joinType.includes('CROSS') || edge.joinType.includes('Implicit') ? '5,5' : undefined}
            className="transition-all"
          />

          {/* Arrow Head */}
          <circle cx={x2} cy={y2} r={4.5} fill={strokeColor} />

          {/* Interactive ON condition pill on edge midpoint */}
          <foreignObject
            x={midX - 140}
            y={midY - 26}
            width={280}
            height={56}
            className="overflow-visible"
          >
            <div
              className={`edge-pill mx-auto flex flex-col items-center justify-center p-1.5 px-2.5 rounded-lg border text-center shadow-sm transition-all select-none cursor-pointer ${
                isSelected
                  ? 'bg-pink-50 border-[#e20074] text-[#e20074] ring-2 ring-[#e20074]/30 scale-105'
                  : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700 hover:border-slate-400'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedEdgeId(edge.id);
                setSelectedNodeId(null);
              }}
              title={`ON Condition: ${edge.onCondition}`}
            >
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                <Link2 className="w-3 h-3 text-[#e20074] shrink-0" />
                <span className="font-mono text-[#e20074]">{edge.joinType}</span>
                <span className="text-slate-400 font-normal">ON</span>
              </div>
              <div className="text-[11px] font-mono font-medium truncate max-w-[250px] text-slate-800" title={edge.onCondition}>
                {edge.onCondition}
              </div>
            </div>
          </foreignObject>
        </g>
      );
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col overflow-hidden animate-fadeIn select-none font-sans">
      {/* Top Header & Toolbar */}
      <header className="h-13 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0 shadow-2xs z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#e20074]/10 flex items-center justify-center text-[#e20074]">
              <Workflow className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-slate-900 tracking-tight">
                  Table Dependency & Condition Graph
                </h1>
                <span className="px-2 py-0.5 bg-[#fdf0f6] text-[#e20074] border border-[#f8b4d9] rounded-full text-[10px] font-mono font-bold">
                  SAP HANA
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Visualizing tables, join ON conditions, and table-specific WHERE filters
              </p>
            </div>
          </div>

          <div className="h-5 w-px bg-slate-200 mx-1 hidden md:block" />

          {/* Query Stats Badges */}
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono">
            {parsedGraph.branchCount > 1 && (
              <span className="px-2 py-1 bg-fuchsia-50 text-fuchsia-800 rounded-md border border-fuchsia-200 flex items-center gap-1.5 font-semibold">
                <Workflow className="w-3.5 h-3.5 text-fuchsia-600" />
                <span>{parsedGraph.branchCount} UNION Branches</span>
              </span>
            )}

            <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded-md border border-slate-200 flex items-center gap-1.5 font-semibold">
              <Database className="w-3.5 h-3.5 text-blue-600" />
              <span>{parsedGraph.nodes.filter(n => !n.isOperator).length} Table Occurrences</span>
            </span>

            <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded-md border border-slate-200 flex items-center gap-1.5 font-semibold">
              <Link2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>{parsedGraph.edges.length} Connections</span>
            </span>

            <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded-md border border-slate-200 flex items-center gap-1.5 font-semibold">
              <Filter className="w-3.5 h-3.5 text-amber-600" />
              <span>
                {parsedGraph.nodes.reduce((acc, n) => acc + n.whereConditions.length, 0)} WHERE Filters
              </span>
            </span>
          </div>
        </div>

        {/* Center/Right Toolbar Actions */}
        <div className="flex items-center gap-2">
          {/* Toggle Details Inspector */}
          <button
            type="button"
            onClick={() => setShowInspector((prev) => !prev)}
            className={`p-1.5 rounded-md border text-slate-600 hover:text-slate-900 transition-colors cursor-pointer ${
              showInspector ? 'bg-slate-100 border-slate-300' : 'bg-white border-slate-200 hover:bg-slate-50'
            }`}
            title="Toggle Details Inspector Drawer"
          >
            {showInspector ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>

          {/* Close Screen / Back to SQL Editor */}
          <button
            type="button"
            id="close-graph-screen-btn"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#e20074] hover:bg-[#c70066] text-white rounded-md text-xs font-semibold shadow-xs transition-colors cursor-pointer ml-1"
            title="Return to SQL Editor (Esc)"
          >
            <X className="w-4 h-4" />
            <span>Close Screen</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left / Center: Interactive Graph Canvas or Cards View */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden bg-slate-50 select-none cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDownBackground}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        >
          {/* Canvas Background Grid Pattern */}
          <div
            className="absolute inset-0 pointer-events-none opacity-60"
            style={{
              backgroundImage: 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)',
              backgroundSize: '24px 24px',
            }}
          />

          {/* Floating Canvas Navigation Toolbar */}
          <div className="absolute bottom-6 left-6 z-20 flex items-center gap-1.5 bg-white/95 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-200 shadow-lg text-xs">
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <span className="font-mono text-[11px] font-semibold text-slate-600 px-1 w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-slate-200 mx-1" />
            <button
              type="button"
              onClick={handleFitToScreen}
              className="flex items-center gap-1 px-2 py-1 hover:bg-slate-100 rounded-lg text-slate-700 font-medium transition-colors cursor-pointer"
              title="Fit all tables to screen"
            >
              <Maximize2 className="w-3.5 h-3.5 text-[#e20074]" />
              <span>Fit</span>
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors cursor-pointer"
              title="Reset Zoom & Pan"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search floating bar */}
          <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-200 shadow-md">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search table, alias, or WHERE filter..."
              className="text-xs bg-transparent border-none outline-none text-slate-800 placeholder:text-slate-400 w-52 font-mono"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-slate-400 hover:text-slate-600 text-xs"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Empty State when no SQL or no tables found */}
          {parsedGraph.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-auto">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-8 max-w-md text-center">
                <div className="w-14 h-14 rounded-2xl bg-pink-50 text-[#e20074] flex items-center justify-center mx-auto mb-4">
                  <Workflow className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  No Tables Detected in Query
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Type or paste a SQL query with tables (e.g. <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[#e20074] font-mono">FROM table1 JOIN table2 ON ... WHERE ...</code>) in the editor to visualize table dependencies, join ON conditions, and WHERE filters.
                </p>
              </div>
            </div>
          )}

          {/* Graph Interactive Viewport (Pan & Zoom container) */}
          {parsedGraph.nodes.length > 0 && (
            <div
              className="absolute inset-0 origin-top-left"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
              }}
            >
              {/* SVG Layer for ON condition connector edges */}
              <svg className="absolute inset-0 w-[5000px] h-[5000px] pointer-events-auto overflow-visible z-0">
                <defs>
                  <marker
                    id="arrowhead"
                    viewBox="0 0 10 10"
                    refX="5"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#e20074" />
                  </marker>
                </defs>
                {renderEdgePaths()}
              </svg>

              {/* Table Nodes */}
              {parsedGraph.nodes.map((node) => {
                const pos = nodePositions.get(node.id) || { x: node.x || 100, y: node.y || 100 };
                const isSelected = selectedNodeId === node.id;
                const isMatched = !searchQuery || filteredNodes.some((fn) => fn.id === node.id);

                // Special rendering for Set Operator Combiner (e.g. UNION ALL, UNION)
                if (node.isOperator) {
                  return (
                    <div
                      key={node.id}
                      id={`table-node-${node.id}`}
                      onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                      style={{
                        transform: `translate(${pos.x}px, ${pos.y}px)`,
                        width: '320px',
                      }}
                      className={`graph-node absolute z-10 bg-white rounded-xl border-2 transition-shadow cursor-grab active:cursor-grabbing select-none ${
                        isSelected
                          ? 'border-[#e20074] shadow-xl ring-2 ring-[#e20074]/30'
                          : 'border-fuchsia-300 hover:border-fuchsia-400 shadow-md hover:shadow-lg'
                      } ${!isMatched ? 'opacity-30' : 'opacity-100'}`}
                    >
                      <div className="p-3 bg-fuchsia-50/80 border-b border-fuchsia-100 rounded-t-xl flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-md bg-fuchsia-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                            <Workflow className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-xs text-fuchsia-950 truncate block">
                              {node.displayName}
                            </span>
                            <span className="text-[10px] text-fuchsia-700 font-mono">
                              Set Operation Output
                            </span>
                          </div>
                        </div>

                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-300 shrink-0">
                          {node.joinType}
                        </span>
                      </div>

                      <div className="p-3 space-y-2 text-xs">
                        <div className="p-2.5 bg-fuchsia-50/50 rounded-lg border border-fuchsia-100 text-[11px] text-fuchsia-900 leading-relaxed">
                          Concatenates data from all <strong>{parsedGraph.branchCount}</strong> query branches into a unified result set.
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={node.id}
                    id={`table-node-${node.id}`}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                    style={{
                      transform: `translate(${pos.x}px, ${pos.y}px)`,
                      width: '320px',
                    }}
                    className={`graph-node absolute z-10 bg-white rounded-xl border transition-shadow cursor-grab active:cursor-grabbing select-none ${
                      isSelected
                        ? 'border-[#e20074] shadow-xl ring-2 ring-[#e20074]/30'
                        : 'border-slate-200 hover:border-slate-300 shadow-md hover:shadow-lg'
                    } ${!isMatched ? 'opacity-30' : 'opacity-100'}`}
                  >
                    {/* Node Header */}
                    <div className="p-3 bg-slate-50/90 border-b border-slate-200 rounded-t-xl flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                        <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                          <Database className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                            Table Name
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-xs text-slate-900 truncate font-mono" title={node.tableName}>
                              {node.tableName}
                            </span>
                            {node.alias && (
                              <span className="px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded text-[10px] font-mono font-bold border border-blue-200">
                                AS {node.alias}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                            {node.schemaName ? (
                              <span>Schema: <strong className="text-slate-700">{node.schemaName}</strong></span>
                            ) : (
                              <span className="text-slate-400 italic">(No schema)</span>
                            )}
                          </div>
                          {node.branchName && (
                            <div className={`text-[10px] font-semibold flex items-center gap-1 mt-0.5 ${
                              node.branchName.includes('Subquery') ? 'text-purple-700 font-mono' : 'text-[#e20074]'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                node.branchName.includes('Subquery') ? 'bg-purple-600' : 'bg-[#e20074]'
                              }`} />
                              <span>{node.branchName}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Join Type Badge */}
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                          node.joinType === 'FROM'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : node.joinType.includes('LEFT')
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            : node.joinType.includes('RIGHT')
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : node.joinType === 'TARGET'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : node.joinType.includes('UNION')
                            ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {node.joinType}
                      </span>
                    </div>

                    {/* Node Body: WHERE Conditions for this table */}
                    <div className="p-3 space-y-2.5">
                      {/* WHERE Condition Section inside the Node */}
                      <div className="rounded-lg bg-amber-50/60 border border-amber-200/80 p-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-900 uppercase tracking-wider">
                            <Filter className="w-3 h-3 text-amber-600" />
                            <span>WHERE Conditions</span>
                          </div>
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded">
                            {node.whereConditions.length}
                          </span>
                        </div>

                        {node.whereConditions.length > 0 ? (
                          <div className="space-y-1">
                            {node.whereConditions.map((cond, cIdx) => (
                              <div
                                key={cIdx}
                                className="text-[11px] font-mono text-amber-950 bg-white/90 px-2 py-1 rounded border border-amber-200 shadow-2xs break-words"
                                title={cond}
                              >
                                {cond}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-amber-700/70 italic">
                            No table-specific WHERE filter
                          </div>
                        )}
                      </div>

                      {/* Columns Referenced from this table */}
                      {node.columns.length > 0 && (
                        <div className="text-[11px]">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                            <span>Referenced Columns</span>
                            <span className="font-mono text-slate-500 font-normal">({node.columns.length})</span>
                          </div>
                          <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                            {node.columns.slice(0, 6).map((col, colIdx) => (
                              <span
                                key={colIdx}
                                className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono font-medium border border-slate-200"
                              >
                                {col}
                              </span>
                            ))}
                            {node.columns.length > 6 && (
                              <span className="px-1.5 py-0.5 bg-slate-50 text-slate-500 rounded text-[10px] font-mono">
                                +{node.columns.length - 6} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Details Inspector Panel */}
        {showInspector && (
          <aside className="w-96 bg-white border-l border-slate-200 flex flex-col shrink-0 overflow-hidden shadow-lg z-20">
            <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-[#e20074]" />
                <h3 className="text-xs font-bold text-slate-900">
                  {selectedNode ? 'Table Details' : selectedEdge ? 'Join & ON Condition' : 'Graph Overview'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowInspector(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Selected Node Details */}
              {selectedNode && (
                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Table Identification
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500 font-medium">Table Name:</span>
                        <span className="text-xs font-bold font-mono text-slate-900">{selectedNode.tableName}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500 font-medium">Schema:</span>
                        <span className="text-xs font-mono text-slate-700">
                          {selectedNode.schemaName ? selectedNode.schemaName : <em className="text-slate-400 font-normal">(No schema)</em>}
                        </span>
                      </div>
                      {selectedNode.alias && (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-500 font-medium">Alias:</span>
                          <span className="px-1.5 py-0.5 bg-[#fdf0f6] text-[#e20074] rounded text-[10px] font-mono font-bold">
                            AS {selectedNode.alias}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                        <span className="text-[11px] text-slate-500 font-medium">Full Reference:</span>
                        <span className="text-xs font-mono text-slate-800 font-semibold">{selectedNode.fullTableName}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500 font-medium">Join Role:</span>
                        <strong className="text-xs font-mono text-slate-800">{selectedNode.joinType}</strong>
                      </div>
                    </div>
                  </div>

                  {/* WHERE conditions for this table */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span>WHERE Conditions</span>
                      <span className="font-mono text-[#e20074] font-bold">{selectedNode.whereConditions.length}</span>
                    </div>

                    {selectedNode.whereConditions.length > 0 ? (
                      <div className="space-y-1.5">
                        {selectedNode.whereConditions.map((cond, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 bg-amber-50/80 border border-amber-200 rounded-lg text-xs font-mono text-amber-950 flex items-start justify-between gap-2"
                          >
                            <span className="break-all">{cond}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyText(cond, 'node', `${selectedNode.id}_${idx}`)}
                              className="text-amber-700 hover:text-amber-900 shrink-0 mt-0.5"
                              title="Copy condition"
                            >
                              {copiedNodeId === `${selectedNode.id}_${idx}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200 italic">
                        No WHERE filter assigned directly to this table.
                      </div>
                    )}
                  </div>

                  {/* ON conditions connecting to this table */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Join Relationships & ON Conditions
                    </div>
                    {parsedGraph.edges.filter((e) => e.targetId === selectedNode.id || e.sourceId === selectedNode.id).length > 0 ? (
                      <div className="space-y-2">
                        {parsedGraph.edges
                          .filter((e) => e.targetId === selectedNode.id || e.sourceId === selectedNode.id)
                          .map((edge) => (
                            <div key={edge.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                              <div className="flex items-center justify-between font-semibold text-slate-800">
                                <span>{edge.sourceName} ➔ {edge.targetName}</span>
                                <span className="text-[10px] font-mono text-[#e20074]">{edge.joinType}</span>
                              </div>
                              <div className="text-[11px] font-mono text-slate-700 bg-white p-1.5 rounded border border-slate-200 break-all">
                                {edge.onCondition}
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200 italic">
                        Root table (Base FROM clause)
                      </div>
                    )}
                  </div>

                  {/* Columns */}
                  {selectedNode.columns.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Referenced Columns ({selectedNode.columns.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedNode.columns.map((col, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 bg-slate-100 text-slate-800 rounded-md text-xs font-mono border border-slate-200"
                          >
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Selected Edge Details */}
              {selectedEdge && !selectedNode && (
                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Join Relationship
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900">{selectedEdge.joinType}</span>
                      </div>
                      <div className="text-xs text-slate-700 flex items-center gap-1.5">
                        <strong className="font-mono">{selectedEdge.sourceName}</strong>
                        <ArrowRight className="w-3.5 h-3.5 text-[#e20074]" />
                        <strong className="font-mono">{selectedEdge.targetName}</strong>
                      </div>
                    </div>
                  </div>

                  {/* ON Condition Breakdown */}
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span>ON Condition Expression</span>
                      <button
                        type="button"
                        onClick={() => handleCopyText(selectedEdge.onCondition, 'edge', selectedEdge.id)}
                        className="text-[#e20074] hover:underline text-[11px] font-mono flex items-center gap-1"
                      >
                        {copiedEdgeId === selectedEdge.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>Copy ON</span>
                      </button>
                    </div>
                    <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl text-xs font-mono text-emerald-950 break-all leading-relaxed">
                      {selectedEdge.onCondition}
                    </div>
                  </div>

                  {selectedEdge.detailedConditions.length > 1 && (
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Individual Predicates
                      </div>
                      <div className="space-y-1.5">
                        {selectedEdge.detailedConditions.map((pred, i) => (
                          <div key={i} className="p-2 bg-slate-50 rounded border text-xs font-mono text-slate-800">
                            {pred}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* General Overview when nothing is clicked */}
              {!selectedNode && !selectedEdge && (
                <div className="space-y-4 text-xs text-slate-600">
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <h4 className="font-bold text-slate-800 mb-1">Interactive Instructions</h4>
                    <ul className="list-disc pl-4 space-y-1 text-slate-600 text-[11px]">
                      <li><strong>Click any Table node</strong> to inspect its columns, join role, and WHERE filters.</li>
                      <li><strong>Click any ON condition pill</strong> on the edges to view and copy join expressions.</li>
                      <li><strong>Drag table nodes</strong> to customize the topology layout.</li>
                      <li><strong>Scroll or pinch</strong> to zoom in and out.</li>
                    </ul>
                  </div>

                  {/* Global WHERE conditions */}
                  {parsedGraph.globalWhereConditions.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Cross-Table WHERE Conditions ({parsedGraph.globalWhereConditions.length})
                      </div>
                      <div className="space-y-1.5">
                        {parsedGraph.globalWhereConditions.map((gw, idx) => (
                          <div key={idx} className="p-2 bg-amber-50 border border-amber-200 rounded text-[11px] font-mono text-amber-950">
                            {gw}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

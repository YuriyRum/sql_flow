import React, { useState, useEffect, useMemo } from 'react';
import { FlowPipeline, SQLNode, RecurrenceSchedule } from './types';
import { SAMPLE_PIPELINES } from './data/samplePipelines';
import { INITIAL_INDEPENDENT_SCHEDULES } from './utils/scheduleUtils';
import { FlowCanvas } from './components/FlowCanvas';
import { FullSizeSqlEditor } from './components/FullSizeSqlEditor';
import { PipelineSimulationModal } from './components/PipelineSimulationModal';
import { ExportModal } from './components/ExportModal';
import { NewPipelineModal } from './components/NewPipelineModal';
import { FullScreenDocModal } from './components/FullScreenDocModal';
import { SqlStatementList } from './components/SqlStatementList';
import { RecurrenceConfigScreen } from './components/RecurrenceConfigScreen';
import {
  GitBranch,
  Play,
  Download,
  Sparkles,
  ArrowLeft,
  Table as TableIcon
} from 'lucide-react';

const STORAGE_KEY = 'sap_hana_sql_flow_pipelines_v2';

export default function App() {
  const [pipelines, setPipelines] = useState<FlowPipeline[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const hasNonSelectInDefault = parsed.some(
            (p: FlowPipeline) =>
              (p.id === 'pipe-s4-sales-etl' || p.id === 'pipe-gl-reconciliation') &&
              p.nodes.some((n) => n.queryType !== 'SELECT' || !n.sqlContent.trim().toUpperCase().startsWith('SELECT'))
          );
          if (!hasNonSelectInDefault) {
            return parsed;
          }
        }
      }
    } catch (e) {
      console.error('Error loading saved pipelines:', e);
    }
    return SAMPLE_PIPELINES;
  });

  const [activePipelineId, setActivePipelineId] = useState<string>(() => {
    return pipelines[0]?.id || 'pipe-s4-sales-etl';
  });

  // Independent recurrence schedule profiles state
  const [customSchedules, setCustomSchedules] = useState<RecurrenceSchedule[]>(() => {
    try {
      const saved = localStorage.getItem('sap_hana_custom_schedules');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error loading saved schedules:', e);
    }
    return INITIAL_INDEPENDENT_SCHEDULES;
  });

  // Main screen mode: 'table' (default full screen table), 'graph' (full screen graph), or 'recurrence' (full screen recurrence scheduler)
  const [activeScreen, setActiveScreen] = useState<'table' | 'graph' | 'recurrence'>('table');
  const [recurrenceNodeId, setRecurrenceNodeId] = useState<string | null>(null);

  // Current active pipeline
  const activePipeline = pipelines.find((p) => p.id === activePipelineId) || pipelines[0];

  // Selection state for Table list
  const [selectedListNodeIds, setSelectedListNodeIds] = useState<string[]>(() => {
    return activePipeline?.nodes.map((n) => n.id) || [];
  });

  // Active graph node IDs
  const [graphNodeIds, setGraphNodeIds] = useState<string[]>(() => {
    return activePipeline?.nodes.map((n) => n.id) || [];
  });

  // Sync selection when pipeline changes
  useEffect(() => {
    if (activePipeline) {
      const allIds = activePipeline.nodes.map((n) => n.id);
      setSelectedListNodeIds(allIds);
      setGraphNodeIds(allIds);
    }
  }, [activePipelineId]);

  // Active node being edited in Full-Size SQL Editor
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Active node being viewed in Full Screen Documentation
  const [docNodeId, setDocNodeId] = useState<string | null>(null);

  // Modals
  const [isSimulationOpen, setIsSimulationOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isNewPipelineOpen, setIsNewPipelineOpen] = useState(false);

  // Save pipelines to localStorage with debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pipelines));
        localStorage.setItem('sap_hana_custom_schedules', JSON.stringify(customSchedules));
      } catch (e) {
        console.error('Error saving pipelines:', e);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [pipelines, customSchedules]);

  // Selected node for Full Size Editor
  const selectedNode = selectedNodeId
    ? activePipeline?.nodes.find((n) => n.id === selectedNodeId) || null
    : null;

  // Selected node for Documentation
  const docNode = docNodeId
    ? activePipeline?.nodes.find((n) => n.id === docNodeId) || null
    : null;

  // Selection Handlers
  const handleToggleSelectNode = (nodeId: string) => {
    setSelectedListNodeIds((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
    );
  };

  const handleSelectAll = () => {
    if (!activePipeline) return;
    setSelectedListNodeIds(activePipeline.nodes.map((n) => n.id));
  };

  const handleDeselectAll = () => {
    setSelectedListNodeIds([]);
  };

  // Open Graph for all selected statements
  const handleShowGraph = () => {
    if (selectedListNodeIds.length === 0) {
      // If none selected, default to all statements
      const allIds = activePipeline.nodes.map((n) => n.id);
      setSelectedListNodeIds(allIds);
      setGraphNodeIds(allIds);
    } else {
      setGraphNodeIds([...selectedListNodeIds]);
    }
    setActiveScreen('graph');
  };

  // Open Graph specifically for a single statement row
  const handleOpenGraphForRow = (node: SQLNode) => {
    // Collect target node + any connected nodes in pipeline
    const connectedNodeIds = new Set<string>([node.id]);
    
    // Check incoming and outgoing connections from pipeline edges
    (activePipeline.edges || []).forEach((edge) => {
      if (edge.source === node.id) connectedNodeIds.add(edge.target);
      if (edge.target === node.id) connectedNodeIds.add(edge.source);
    });

    const targetNodeIds = Array.from(connectedNodeIds);
    setGraphNodeIds(targetNodeIds);
    setSelectedListNodeIds(targetNodeIds);
    setActiveScreen('graph');
  };

  // Node Mutation Handlers
  const handleSaveNode = (updatedNode: SQLNode) => {
    setPipelines((prev) =>
      prev.map((pipe) => {
        if (pipe.id !== activePipeline.id) return pipe;
        const updatedNodes = pipe.nodes.map((n) => (n.id === updatedNode.id ? updatedNode : n));
        return { ...pipe, nodes: updatedNodes, updatedAt: new Date().toISOString() };
      })
    );
  };

  const handleToggleNodeActive = (nodeId: string, active: boolean) => {
    setPipelines((prev) =>
      prev.map((pipe) => {
        if (pipe.id !== activePipeline.id) return pipe;
        const updatedNodes = pipe.nodes.map((n) =>
          n.id === nodeId ? { ...n, enabled: active } : n
        );
        return { ...pipe, nodes: updatedNodes, updatedAt: new Date().toISOString() };
      })
    );
  };

  const handleUpdateNodeDescription = (nodeId: string, description: string) => {
    setPipelines((prev) =>
      prev.map((pipe) => {
        if (pipe.id !== activePipeline.id) return pipe;
        const updatedNodes = pipe.nodes.map((n) =>
          n.id === nodeId ? { ...n, description } : n
        );
        return { ...pipe, nodes: updatedNodes, updatedAt: new Date().toISOString() };
      })
    );
  };

  const handleOpenRecurrenceScreen = (node?: SQLNode) => {
    if (node) {
      setRecurrenceNodeId(node.id);
    } else if (activePipeline?.nodes[0]) {
      setRecurrenceNodeId(activePipeline.nodes[0].id);
    }
    setActiveScreen('recurrence');
  };

  const handleCreateSchedule = (newSchedule: RecurrenceSchedule) => {
    setCustomSchedules((prev) => [...prev, newSchedule]);
  };

  const handleUpdateSchedule = (updatedSchedule: RecurrenceSchedule) => {
    setCustomSchedules((prev) =>
      prev.map((s) => (s.id === updatedSchedule.id ? updatedSchedule : s))
    );
  };

  const handleDeleteSchedule = (scheduleId: string) => {
    setCustomSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
    setPipelines((prev) =>
      prev.map((pipe) => {
        const updatedNodes = pipe.nodes.map((n) =>
          n.scheduleId === scheduleId ? { ...n, scheduleId: 'SCHED-DAILY-6AM' } : n
        );
        return { ...pipe, nodes: updatedNodes, updatedAt: new Date().toISOString() };
      })
    );
  };

  const handleAssignScheduleToNode = (nodeId: string, scheduleId: string) => {
    setPipelines((prev) =>
      prev.map((pipe) => {
        if (pipe.id !== activePipeline.id) return pipe;
        const updatedNodes = pipe.nodes.map((n) =>
          n.id === nodeId ? { ...n, scheduleId } : n
        );
        return { ...pipe, nodes: updatedNodes, updatedAt: new Date().toISOString() };
      })
    );
  };

  const handleAssignScheduleToAllNodes = (scheduleId: string) => {
    setPipelines((prev) =>
      prev.map((pipe) => {
        if (pipe.id !== activePipeline.id) return pipe;
        const updatedNodes = pipe.nodes.map((n) => ({ ...n, scheduleId }));
        return { ...pipe, nodes: updatedNodes, updatedAt: new Date().toISOString() };
      })
    );
  };

  const handleAddNode = () => {
    if (!activePipeline) return;
    const newIndex = activePipeline.nodes.length + 1;
    const newNodeId = `node_${Date.now().toString(36)}`;
    const newNode: SQLNode = {
      id: newNodeId,
      name: `V_CUSTOM_STATEMENT_${newIndex}`,
      description: `Custom SQL statement #${newIndex}`,
      queryType: 'SELECT',
      sqlContent: `SELECT \n    "CUSTOMER_ID",\n    COUNT(*) AS "TOTAL_ORDERS"\nFROM "SAP_S4HANA"."VBAK"\nGROUP BY "CUSTOMER_ID";`,
      executionOrder: newIndex,
      status: 'idle',
      enabled: true,
      position: { x: 120 + newIndex * 40, y: 140 + (newIndex % 3) * 60 },
      nextNodeIds: [],
      inputTables: ['"SAP_S4HANA"."VBAK"'],
      targetSchema: 'STAGE',
      targetTable: `V_CUSTOM_STATEMENT_${newIndex}`,
    };

    const updatedPipeline = {
      ...activePipeline,
      nodes: [...activePipeline.nodes, newNode],
      updatedAt: new Date().toISOString(),
    };

    handleUpdatePipeline(updatedPipeline);
    setSelectedListNodeIds((prev) => [...prev, newNodeId]);
    setGraphNodeIds((prev) => [...prev, newNodeId]);
    setSelectedNodeId(newNodeId);
  };

  const handleDeleteNode = (nodeId: string) => {
    setPipelines((prev) =>
      prev.map((pipe) => {
        if (pipe.id !== activePipeline.id) return pipe;
        const updatedNodes = pipe.nodes.filter((n) => n.id !== nodeId);
        const updatedEdges = (pipe.edges || []).filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        );
        return {
          ...pipe,
          nodes: updatedNodes,
          edges: updatedEdges,
          updatedAt: new Date().toISOString(),
        };
      })
    );
    setSelectedListNodeIds((prev) => prev.filter((id) => id !== nodeId));
    setGraphNodeIds((prev) => prev.filter((id) => id !== nodeId));
  };

  const handleUpdatePipeline = (updatedPipeline: FlowPipeline) => {
    setPipelines((prev) =>
      prev.map((pipe) => (pipe.id === updatedPipeline.id ? updatedPipeline : pipe))
    );
  };

  // Sync canvas modifications back into active pipeline
  const handleUpdatePipelineFromCanvas = (updatedSubPipeline: FlowPipeline) => {
    setPipelines((prev) =>
      prev.map((pipe) => {
        if (pipe.id !== activePipeline.id) return pipe;

        const subNodeMap = new Map(updatedSubPipeline.nodes.map((n) => [n.id, n]));
        const newNodes = pipe.nodes.map((n) => subNodeMap.get(n.id) || n);

        const existingIds = new Set(pipe.nodes.map((n) => n.id));
        for (const subNode of updatedSubPipeline.nodes) {
          if (!existingIds.has(subNode.id)) {
            newNodes.push(subNode);
          }
        }

        return {
          ...pipe,
          nodes: newNodes,
          edges: updatedSubPipeline.edges,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  };

  const handleCreatePipeline = (newPipeline: FlowPipeline) => {
    setPipelines((prev) => [newPipeline, ...prev]);
    setActivePipelineId(newPipeline.id);
  };

  // Filtered Sub-Pipeline for Graph View
  const filteredSubPipeline = useMemo(() => {
    if (!activePipeline) return null;
    const filteredNodes = activePipeline.nodes.filter((n) => graphNodeIds.includes(n.id));
    const nodeSet = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = (activePipeline.edges || []).filter(
      (e) => nodeSet.has(e.source) && nodeSet.has(e.target)
    );

    return {
      ...activePipeline,
      nodes: filteredNodes,
      edges: filteredEdges,
    };
  }, [activePipeline, graphNodeIds]);

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100 text-slate-900 overflow-hidden font-sans">
      {/* SCREEN 1: Full-Screen Table View (Default View, NOT Split) */}
      {activeScreen === 'table' && activePipeline && (
        <div className="flex-1 w-full h-full overflow-hidden flex flex-col">
          <SqlStatementList
            pipeline={activePipeline}
            selectedNodeIds={selectedListNodeIds}
            onToggleSelectNode={handleToggleSelectNode}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onShowGraph={handleShowGraph}
            onOpenEditor={(node) => setSelectedNodeId(node.id)}
            onToggleNodeActive={handleToggleNodeActive}
            onUpdateNodeDescription={handleUpdateNodeDescription}
            onAddNode={handleAddNode}
            onDeleteNode={handleDeleteNode}
            onOpenDocumentation={(node) => setDocNodeId(node.id)}
            allPipelines={pipelines}
            onSelectPipeline={(id) => setActivePipelineId(id)}
            onNewPipeline={() => setIsNewPipelineOpen(true)}
            onRunSimulation={() => setIsSimulationOpen(true)}
            onExport={() => setIsExportOpen(true)}
            onOpenRecurrenceScreen={handleOpenRecurrenceScreen}
            schedules={customSchedules}
            onAssignScheduleToNode={handleAssignScheduleToNode}
          />
        </div>
      )}

      {/* SCREEN 3: Full-Screen Recurrence Configuration Screen */}
      {activeScreen === 'recurrence' && activePipeline && (
        <RecurrenceConfigScreen
          pipeline={activePipeline}
          selectedNodeId={recurrenceNodeId || (activePipeline.nodes[0]?.id || null)}
          schedules={customSchedules}
          onCreateSchedule={handleCreateSchedule}
          onUpdateSchedule={handleUpdateSchedule}
          onDeleteSchedule={handleDeleteSchedule}
          onAssignScheduleToNode={handleAssignScheduleToNode}
          onAssignScheduleToAllNodes={handleAssignScheduleToAllNodes}
          onClose={() => setActiveScreen('table')}
          allPipelines={pipelines}
          onSelectPipeline={(id) => setActivePipelineId(id)}
        />
      )}

      {/* SCREEN 2: Full-Screen Graph View (Opened via row "Graph" or "Show Graph" action) */}
      {activeScreen === 'graph' && (
        <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-slate-900 relative">
          {/* Top Bar Header for Graph Screen */}
          <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex flex-wrap items-center justify-between gap-3 shrink-0 z-10 text-white">
            <div className="flex items-center gap-3">
              {/* BACK TO TABLE BUTTON */}
              <button
                type="button"
                onClick={() => setActiveScreen('table')}
                className="flex items-center gap-2 px-3 py-1.5 bg-[#e20074] hover:bg-[#c70066] text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Statements Table</span>
              </button>

              <div className="h-5 w-px bg-slate-700 hidden sm:block" />

              <div className="flex items-center gap-2">
                <div className="p-1 bg-slate-700 text-[#e20074] rounded">
                  <GitBranch className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-xs text-white leading-none">
                    Dependency Flow Graph
                  </h2>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Showing {filteredSubPipeline?.nodes.length || 0} of {activePipeline.nodes.length} SQL statements
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions in Graph Header */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const allIds = activePipeline.nodes.map((n) => n.id);
                  setSelectedListNodeIds(allIds);
                  setGraphNodeIds(allIds);
                }}
                className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold border border-slate-600 transition-colors cursor-pointer"
                title="Include all pipeline statements in graph"
              >
                Show All ({activePipeline.nodes.length})
              </button>

              <button
                type="button"
                onClick={() => setIsSimulationOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Run Test</span>
              </button>

              <button
                type="button"
                onClick={() => setIsExportOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold transition-colors border border-slate-600 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Export</span>
              </button>
            </div>
          </div>

          {/* Graph Content Canvas */}
          <div className="flex-1 relative overflow-hidden bg-slate-950">
            {filteredSubPipeline && filteredSubPipeline.nodes.length > 0 ? (
              <FlowCanvas
                pipeline={filteredSubPipeline}
                onSelectNode={(node) => setSelectedNodeId(node.id)}
                onUpdatePipeline={handleUpdatePipelineFromCanvas}
                onRunSimulation={() => setIsSimulationOpen(true)}
                onExport={() => setIsExportOpen(true)}
                onSelectPipeline={(id) => setActivePipelineId(id)}
                allPipelines={pipelines}
                onNewPipeline={() => setIsNewPipelineOpen(true)}
                onOpenDocumentation={(node) => setDocNodeId(node.id)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center text-slate-300">
                <p className="text-slate-400 text-sm mb-4">No SQL statements selected for graph view.</p>
                <button
                  type="button"
                  onClick={() => setActiveScreen('table')}
                  className="px-4 py-2 bg-[#e20074] text-white rounded-lg text-xs font-bold shadow-md hover:bg-[#c70066] transition-colors cursor-pointer"
                >
                  Return to Statements Table
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full-Size SAP HANA SQL Editor Modal */}
      {selectedNode && (
        <FullSizeSqlEditor
          node={selectedNode}
          pipeline={activePipeline}
          onSaveNode={handleSaveNode}
          onClose={() => setSelectedNodeId(null)}
          onNavigateNode={(newNodeId) => setSelectedNodeId(newNodeId)}
          onOpenDocumentation={(node) => setDocNodeId(node.id)}
        />
      )}

      {/* Full Screen Technical Documentation Modal */}
      {docNode && (
        <FullScreenDocModal
          node={docNode}
          isOpen={!!docNode}
          onClose={() => setDocNodeId(null)}
          onSaveNode={handleSaveNode}
        />
      )}

      {/* Pipeline Simulation Runner Modal */}
      {activePipeline && (
        <PipelineSimulationModal
          pipeline={activePipeline}
          isOpen={isSimulationOpen}
          onClose={() => setIsSimulationOpen(false)}
          onSelectNode={(node) => setSelectedNodeId(node.id)}
        />
      )}

      {/* Pipeline Export Modal */}
      {activePipeline && (
        <ExportModal
          pipeline={activePipeline}
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
        />
      )}

      {/* New Pipeline Process Creator Modal */}
      <NewPipelineModal
        isOpen={isNewPipelineOpen}
        onClose={() => setIsNewPipelineOpen(false)}
        onCreatePipeline={handleCreatePipeline}
      />
    </div>
  );
}

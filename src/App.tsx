import React, { useState, useEffect } from 'react';
import { FlowPipeline, SQLNode } from './types';
import { SAMPLE_PIPELINES } from './data/samplePipelines';
import { FlowCanvas } from './components/FlowCanvas';
import { FullSizeSqlEditor } from './components/FullSizeSqlEditor';
import { PipelineSimulationModal } from './components/PipelineSimulationModal';
import { ExportModal } from './components/ExportModal';
import { NewPipelineModal } from './components/NewPipelineModal';
import { FullScreenDocModal } from './components/FullScreenDocModal';

const STORAGE_KEY = 'sap_hana_sql_flow_pipelines_v2';

export default function App() {
  const [pipelines, setPipelines] = useState<FlowPipeline[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Verify that default pipelines have pure SELECT queries
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
      } catch (e) {
        console.error('Error saving pipelines:', e);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [pipelines]);

  // Current active pipeline
  const activePipeline = pipelines.find((p) => p.id === activePipelineId) || pipelines[0];

  // Current selected node for Full Size Editor
  const selectedNode = selectedNodeId
    ? activePipeline?.nodes.find((n) => n.id === selectedNodeId) || null
    : null;

  // Current selected node for Full Screen Documentation
  const docNode = docNodeId
    ? activePipeline?.nodes.find((n) => n.id === docNodeId) || null
    : null;

  // Handle node updates from Full Size Editor or Canvas
  const handleSaveNode = (updatedNode: SQLNode) => {
    setPipelines((prev) =>
      prev.map((pipe) => {
        if (pipe.id !== activePipeline.id) return pipe;
        const updatedNodes = pipe.nodes.map((n) => (n.id === updatedNode.id ? updatedNode : n));
        return { ...pipe, nodes: updatedNodes, updatedAt: new Date().toISOString() };
      })
    );
  };

  // Handle pipeline structural updates (add node, reorder, auto-layout, delete)
  const handleUpdatePipeline = (updatedPipeline: FlowPipeline) => {
    setPipelines((prev) =>
      prev.map((pipe) => (pipe.id === updatedPipeline.id ? updatedPipeline : pipe))
    );
  };

  const handleCreatePipeline = (newPipeline: FlowPipeline) => {
    setPipelines((prev) => [newPipeline, ...prev]);
    setActivePipelineId(newPipeline.id);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* Main Flow Canvas View */}
      <main className="flex-1 relative flex flex-col overflow-hidden">
        {activePipeline && (
          <FlowCanvas
            pipeline={activePipeline}
            onSelectNode={(node) => setSelectedNodeId(node.id)}
            onUpdatePipeline={handleUpdatePipeline}
            onRunSimulation={() => setIsSimulationOpen(true)}
            onExport={() => setIsExportOpen(true)}
            onSelectPipeline={(id) => setActivePipelineId(id)}
            allPipelines={pipelines}
            onNewPipeline={() => setIsNewPipelineOpen(true)}
            onOpenDocumentation={(node) => setDocNodeId(node.id)}
          />
        )}
      </main>

      {/* Full-Size SAP HANA SQL Editor Modal/View */}
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

      {/* Full Screen Node Technical Documentation Modal */}
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

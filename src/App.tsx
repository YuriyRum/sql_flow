import React, { useState, useEffect } from 'react';
import { FlowPipeline, SQLNode } from './types';
import { SAMPLE_PIPELINES } from './data/samplePipelines';
import { FullSizeSqlEditor } from './components/FullSizeSqlEditor';

const STORAGE_KEY = 'sap_hana_sql_select_editor_pipelines_v3';

export default function App() {
  const [pipelines, setPipelines] = useState<FlowPipeline[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Error loading saved pipelines:', e);
    }
    return SAMPLE_PIPELINES;
  });

  const [activePipelineId] = useState<string>(() => {
    return pipelines[0]?.id || 'pipe-s4-sales-etl';
  });

  const activePipeline = pipelines.find((p) => p.id === activePipelineId) || pipelines[0];

  const [selectedNodeId, setSelectedNodeId] = useState<string>(() => {
    return activePipeline?.nodes[0]?.id || 'node-vbak-orders';
  });

  // Keep selectedNodeId valid if activePipeline changes
  useEffect(() => {
    if (activePipeline && !activePipeline.nodes.some((n) => n.id === selectedNodeId)) {
      if (activePipeline.nodes[0]) {
        setSelectedNodeId(activePipeline.nodes[0].id);
      }
    }
  }, [activePipeline, selectedNodeId]);

  // Save pipelines to localStorage
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pipelines));
      } catch (e) {
        console.error('Error saving pipelines:', e);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [pipelines]);

  // Selected node object
  const selectedNode =
    activePipeline?.nodes.find((n) => n.id === selectedNodeId) || activePipeline?.nodes[0];

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

  const handleAddNode = () => {
    if (!activePipeline) return;
    const newIndex = activePipeline.nodes.length + 1;
    const newNodeId = `node_${Date.now().toString(36)}`;
    const newNode: SQLNode = {
      id: newNodeId,
      name: `V_CUSTOM_SELECT_${newIndex}`,
      description: `Custom SQL SELECT query #${newIndex}`,
      queryType: 'SELECT',
      sqlContent: `-- SAP HANA Cloud SQL SELECT Query #${newIndex}\nSELECT \n    "CUSTOMER_ID",\n    COUNT(*) AS "TOTAL_ORDERS",\n    SUM("NET_AMOUNT") AS "TOTAL_REVENUE"\nFROM "SAP_S4HANA"."VBAK"\nWHERE "ORDER_DATE" >= ADD_MONTHS(CURRENT_DATE, -12)\nGROUP BY "CUSTOMER_ID"\nORDER BY "TOTAL_REVENUE" DESC;`,
      executionOrder: newIndex,
      status: 'idle',
      enabled: true,
      position: { x: 0, y: 0 },
      nextNodeIds: [],
      inputTables: ['"SAP_S4HANA"."VBAK"'],
      targetSchema: 'STAGE',
      targetTable: `V_CUSTOM_SELECT_${newIndex}`,
    };

    setPipelines((prev) =>
      prev.map((pipe) => {
        if (pipe.id !== activePipeline.id) return pipe;
        return {
          ...pipe,
          nodes: [...pipe.nodes, newNode],
          updatedAt: new Date().toISOString(),
        };
      })
    );
    setSelectedNodeId(newNodeId);
  };

  const handleDeleteNode = (nodeId: string) => {
    if (!activePipeline || activePipeline.nodes.length <= 1) return;
    setPipelines((prev) =>
      prev.map((pipe) => {
        if (pipe.id !== activePipeline.id) return pipe;
        const updatedNodes = pipe.nodes.filter((n) => n.id !== nodeId);
        return {
          ...pipe,
          nodes: updatedNodes,
          updatedAt: new Date().toISOString(),
        };
      })
    );

    const remaining = activePipeline.nodes.filter((n) => n.id !== nodeId);
    if (remaining.length > 0) {
      setSelectedNodeId(remaining[0].id);
    }
  };

  if (!selectedNode || !activePipeline) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100 text-slate-700 font-sans">
        <p className="text-sm">Loading SQL Editor...</p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-white text-slate-800 font-sans relative">
      <FullSizeSqlEditor
        node={selectedNode}
        pipeline={activePipeline}
        onSaveNode={handleSaveNode}
        onNavigateNode={(newNodeId) => setSelectedNodeId(newNodeId)}
        onAddNode={handleAddNode}
        onDeleteNode={handleDeleteNode}
      />
    </div>
  );
}

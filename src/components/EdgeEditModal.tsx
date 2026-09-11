import React, { useState, useEffect } from 'react';
import { FlowEdge, FlowPipeline } from '../types';
import { detectCycleIfEdgeAdded } from '../utils/pipelineTopology';
import { X, Trash2, ArrowRight, Check, GitBranch, AlertCircle, RefreshCw } from 'lucide-react';

interface EdgeEditModalProps {
  edge?: FlowEdge | null;
  pipeline: FlowPipeline;
  isOpen: boolean;
  onClose: () => void;
  onSaveEdge: (sourceId: string, targetId: string, label: string, edgeId?: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
}

export const EdgeEditModal: React.FC<EdgeEditModalProps> = ({
  edge,
  pipeline,
  isOpen,
  onClose,
  onSaveEdge,
  onDeleteEdge,
}) => {
  const [sourceId, setSourceId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [label, setLabel] = useState<string>('Executes Next');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (edge) {
      setSourceId(edge.source);
      setTargetId(edge.target);
      setLabel(edge.label || 'Executes Next');
      setError(null);
    } else if (pipeline.nodes.length >= 2) {
      setSourceId(pipeline.nodes[0]?.id || '');
      setTargetId(pipeline.nodes[1]?.id || '');
      setLabel('Executes Next');
      setError(null);
    }
  }, [edge, pipeline, isOpen]);

  if (!isOpen) return null;

  // Check if this connection forms a circular dependency
  const cycleCheck =
    sourceId && targetId
      ? detectCycleIfEdgeAdded(pipeline.nodes, pipeline.edges, sourceId, targetId, edge?.id)
      : { createsCycle: false, summary: '' };

  const handleSave = () => {
    if (!sourceId || !targetId) {
      setError('Please select both a source step and a target step.');
      return;
    }
    if (sourceId === targetId) {
      setError('A SQL step cannot link directly to itself (self-cycle loop).');
      return;
    }

    // Check if duplicate
    const isDuplicate = pipeline.edges.some(
      (e) => e.source === sourceId && e.target === targetId && (!edge || e.id !== edge.id)
    );
    if (isDuplicate) {
      setError('An edge already exists connecting these two query steps.');
      return;
    }

    onSaveEdge(sourceId, targetId, label.trim() || 'Executes Next', edge?.id);
    onClose();
  };

  const sortedNodes = [...pipeline.nodes].sort((a, b) => a.executionOrder - b.executionOrder);

  const sourceNode = pipeline.nodes.find((n) => n.id === sourceId);
  const targetNode = pipeline.nodes.find((n) => n.id === targetId);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-scaleUp">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#fdf0f6] rounded-lg border border-[#f8b4d9] text-[#e20074]">
              <GitBranch className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-900">
                {edge ? 'Edit Execution Edge' : 'Create Execution Edge'}
              </h3>
              <p className="text-[11px] text-slate-500">
                Defines sequential order and dependency flow between SQL queries
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Real-time Cycle Warning */}
          {cycleCheck.createsCycle && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1.5 shadow-2xs">
              <div className="flex items-center gap-2 font-semibold text-amber-800">
                <RefreshCw className="w-4 h-4 text-amber-600 shrink-0 animate-spin" style={{ animationDuration: '6s' }} />
                <span>Circular Dependency (Cycle) Detected</span>
              </div>
              <p className="text-[11px] text-amber-700 leading-relaxed">
                Connecting this edge introduces a loop cycle: <span className="font-mono font-semibold">{cycleCheck.summary}</span>. In SQL execution, cyclic queries execute iteratively or recursively.
              </p>
            </div>
          )}

          {/* Visual Step Connection Flow Preview */}
          <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs transition-colors ${
            cycleCheck.createsCycle ? 'bg-amber-50/60 border-amber-200' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Source Step (Executes First)</span>
              <div className="font-semibold text-slate-800 truncate">
                {sourceNode ? `#${sourceNode.executionOrder} ${sourceNode.name}` : 'Select Source'}
              </div>
            </div>

            <div className="flex flex-col items-center justify-center shrink-0 px-2 text-[#e20074]">
              <ArrowRight className="w-5 h-5 animate-pulse" />
              <span className="text-[9px] font-mono text-slate-400 mt-0.5">triggers</span>
            </div>

            <div className="flex-1 min-w-0 text-right">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Target Step (Executes Next)</span>
              <div className="font-semibold text-slate-800 truncate">
                {targetNode ? `#${targetNode.executionOrder} ${targetNode.name}` : 'Select Target'}
              </div>
            </div>
          </div>

          {/* Source Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">
              1. Source SQL Query (Runs Earlier):
            </label>
            <select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setError(null);
              }}
              className="w-full bg-white border border-slate-200 hover:border-slate-300 focus:border-[#e20074] rounded-lg px-3 py-2 text-xs text-slate-800 outline-none transition-colors"
            >
              {sortedNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  Step #{n.executionOrder}: {n.name}
                </option>
              ))}
            </select>
          </div>

          {/* Target Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">
              2. Target SQL Query (Runs Next):
            </label>
            <select
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setError(null);
              }}
              className="w-full bg-white border border-slate-200 hover:border-slate-300 focus:border-[#e20074] rounded-lg px-3 py-2 text-xs text-slate-800 outline-none transition-colors"
            >
              {sortedNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  Step #{n.executionOrder}: {n.name}
                </option>
              ))}
            </select>
          </div>

          {/* Label / Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">
              3. Edge Flow Label (Optional):
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Feed Orders, Data Mart, Next Query"
              className="w-full bg-white border border-slate-200 hover:border-slate-300 focus:border-[#e20074] rounded-lg px-3 py-2 text-xs text-slate-800 outline-none transition-colors"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          {edge && onDeleteEdge ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Delete this execution edge and unlink these two queries?')) {
                  onDeleteEdge(edge.id);
                  onClose();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-medium transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Edge</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#e20074] hover:bg-[#c70066] text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{edge ? 'Update Edge' : 'Create Edge'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

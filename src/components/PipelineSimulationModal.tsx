import React, { useState, useEffect } from 'react';
import { FlowPipeline, SQLNode, ExecutionLog } from '../types';
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Database,
  Layers,
  X,
  Terminal,
  Activity
} from 'lucide-react';

interface PipelineSimulationModalProps {
  pipeline: FlowPipeline;
  isOpen: boolean;
  onClose: () => void;
  onSelectNode: (node: SQLNode) => void;
}

export const PipelineSimulationModal: React.FC<PipelineSimulationModalProps> = ({
  pipeline,
  isOpen,
  onClose,
  onSelectNode,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedNodeIds, setCompletedNodeIds] = useState<string[]>([]);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [activeTab, setActiveTab] = useState<'progress' | 'logs' | 'data'>('progress');

  const sortedNodes = [...pipeline.nodes].sort((a, b) => a.executionOrder - b.executionOrder);

  useEffect(() => {
    if (isOpen) {
      // Reset runner state on open
      setCurrentStepIndex(0);
      setCompletedNodeIds([]);
      setLogs([
        {
          id: `log-init`,
          timestamp: new Date().toLocaleTimeString(),
          nodeId: 'pipeline-init',
          nodeName: pipeline.name,
          level: 'info',
          message: `Pipeline '${pipeline.name}' initialized for SAP HANA Cloud execution simulation.`,
        },
      ]);
      setIsRunning(false);
    }
  }, [isOpen, pipeline]);

  // Step-by-step runner timer
  useEffect(() => {
    let timer: any = null;
    if (isRunning && currentStepIndex < sortedNodes.length) {
      const node = sortedNodes[currentStepIndex];

      timer = setTimeout(() => {
        const hasError = node.validationSummary && !node.validationSummary.isValid;
        const durationMs = Math.floor(Math.random() * 80) + 40;
        const rows = Math.floor(Math.random() * 2500) + 120;

        const newLog: ExecutionLog = {
          id: `log-${node.id}-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          nodeId: node.id,
          nodeName: node.name,
          level: hasError ? 'error' : 'success',
          message: hasError
            ? `Query Step #${node.executionOrder} failed due to SAP HANA syntax diagnostic errors.`
            : `Query Step #${node.executionOrder} executed successfully. Affected rows: ${rows}, In-Memory Duration: ${durationMs}ms.`,
          durationMs,
          rowsAffected: rows,
        };

        setLogs((prev) => [...prev, newLog]);
        setCompletedNodeIds((prev) => [...prev, node.id]);

        if (hasError) {
          setIsRunning(false);
        } else {
          setCurrentStepIndex((prev) => prev + 1);
        }
      }, 700);
    } else if (currentStepIndex >= sortedNodes.length && isRunning) {
      setIsRunning(false);
      setLogs((prev) => [
        ...prev,
        {
          id: `log-complete`,
          timestamp: new Date().toLocaleTimeString(),
          nodeId: 'pipeline-finish',
          nodeName: pipeline.name,
          level: 'success',
          message: `All ${sortedNodes.length} sequence steps executed successfully! Target data marts materialized.`,
        },
      ]);
    }

    return () => clearTimeout(timer);
  }, [isRunning, currentStepIndex, sortedNodes, pipeline]);

  if (!isOpen) return null;

  const totalSteps = sortedNodes.length;
  const progressPercent = totalSteps > 0 ? Math.min(100, Math.round((completedNodeIds.length / totalSteps) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-scaleUp">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-slate-900">{pipeline.name}</h3>
              <p className="text-xs text-slate-500">Sequential SAP HANA Pipeline Execution Simulator</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Runner Controls & Progress */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {!isRunning ? (
              <button
                type="button"
                id="start-simulation-btn"
                onClick={() => {
                  if (currentStepIndex >= sortedNodes.length) {
                    setCurrentStepIndex(0);
                    setCompletedNodeIds([]);
                  }
                  setIsRunning(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#e20074] hover:bg-[#c70066] text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
              >
                <Play className="w-4 h-4" />
                <span>{currentStepIndex >= sortedNodes.length ? 'Re-Run Flow' : 'Start Flow Execution'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsRunning(false)}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
              >
                <Pause className="w-4 h-4" />
                <span>Pause</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setIsRunning(false);
                setCurrentStepIndex(0);
                setCompletedNodeIds([]);
                setLogs([]);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium transition-colors border border-slate-200 shadow-sm"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>

          {/* Progress Bar & Status */}
          <div className="flex-1 max-w-xs w-full space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Step {completedNodeIds.length} of {totalSteps}</span>
              <span className="font-mono font-semibold text-[#e20074]">{progressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#e20074] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-200 bg-white text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('progress')}
            className={`pb-2.5 font-medium border-b-2 transition-colors ${
              activeTab === 'progress' ? 'border-[#e20074] text-[#e20074] font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Sequence Steps Progression
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`pb-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'logs' ? 'border-[#e20074] text-[#e20074] font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Execution Logs ({logs.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
          {activeTab === 'progress' ? (
            <div className="space-y-3">
              {sortedNodes.map((node, idx) => {
                const isCompleted = completedNodeIds.includes(node.id);
                const isCurrent = isRunning && currentStepIndex === idx;

                return (
                  <div
                    key={node.id}
                    onClick={() => {
                      onClose();
                      onSelectNode(node);
                    }}
                    className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all shadow-sm ${
                      isCompleted
                        ? 'bg-emerald-50 border-emerald-200 text-slate-800'
                        : isCurrent
                        ? 'bg-[#fdf0f6] border-[#e20074] ring-2 ring-[#f8b4d9] text-slate-900'
                        : 'bg-white border-slate-200 hover:border-[#f8b4d9] text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-mono text-xs font-bold shrink-0 text-slate-700">
                        {isCompleted ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : isCurrent ? (
                          <div className="w-2.5 h-2.5 bg-[#e20074] rounded-full animate-ping" />
                        ) : (
                          node.executionOrder
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-slate-900">{node.name}</span>
                          <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">
                            {node.queryType}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{node.description}</p>
                      </div>
                    </div>

                    <div className="text-right shrink-0 font-mono text-xs text-slate-500">
                      {isCompleted ? (
                        <span className="text-emerald-700 font-medium">✓ Completed</span>
                      ) : isCurrent ? (
                        <span className="text-[#e20074] font-semibold">Executing...</span>
                      ) : (
                        <span className="text-slate-400">Pending</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-slate-900 rounded-xl p-4 font-mono text-xs space-y-2 border border-slate-800">
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2.5">
                  <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                  <span
                    className={`font-semibold shrink-0 uppercase text-[10px] px-1.5 py-0.5 rounded ${
                      log.level === 'success'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : log.level === 'error'
                        ? 'bg-rose-950 text-rose-400 border border-rose-800'
                        : 'bg-blue-950 text-blue-400 border border-blue-800'
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-slate-200">{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

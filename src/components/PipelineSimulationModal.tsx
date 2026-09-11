import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FlowPipeline, SQLNode, ExecutionLog } from '../types';
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  X,
  Terminal,
  Activity,
  RefreshCw,
  Repeat,
  Sliders,
  Settings2,
  Info
} from 'lucide-react';
import { analyzeGraphCycles } from '../utils/pipelineTopology';

interface PipelineSimulationModalProps {
  pipeline: FlowPipeline;
  isOpen: boolean;
  onClose: () => void;
  onSelectNode: (node: SQLNode) => void;
}

interface ExecutionStep {
  nodeId: string;
  iteration: number;
  isCycleStep: boolean;
  stepSequence: number;
}

export const PipelineSimulationModal: React.FC<PipelineSimulationModalProps> = ({
  pipeline,
  isOpen,
  onClose,
  onSelectNode,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<ExecutionStep[]>([]);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [activeTab, setActiveTab] = useState<'progress' | 'logs' | 'config'>('progress');

  // Cycle Configuration State
  const [executionMode, setExecutionMode] = useState<'iterative' | 'strict'>('iterative');
  const [maxLoopIterations, setMaxLoopIterations] = useState<number>(3);
  const [currentIteration, setCurrentIteration] = useState<number>(1);

  // Compute graph cycle topology
  const cycleAnalysis = useMemo(
    () => analyzeGraphCycles(pipeline.nodes, pipeline.edges),
    [pipeline.nodes, pipeline.edges]
  );

  // Build the execution sequence plan (supporting both linear DAGs and iterative cyclic loops)
  const executionPlan = useMemo(() => {
    const sorted = [...pipeline.nodes].sort((a, b) => a.executionOrder - b.executionOrder);
    if (!cycleAnalysis.hasCycle || executionMode === 'strict') {
      return sorted.map((n, i) => ({
        nodeId: n.id,
        iteration: 1,
        isCycleStep: cycleAnalysis.cycleNodeIds.includes(n.id),
        stepSequence: i + 1,
      }));
    }

    // Build iterative plan:
    // 1. Initial pre-cycle nodes
    // 2. Cycle nodes repeated `maxLoopIterations` times
    // 3. Post-cycle nodes
    const plan: ExecutionStep[] = [];
    let seq = 1;

    // Identify pre-cycle, in-cycle, and post-cycle nodes
    const cycleNodeIdSet = new Set(cycleAnalysis.cycleNodeIds);
    const preCycleNodes = sorted.filter(
      (n) => !cycleNodeIdSet.has(n.id) && n.executionOrder < (sorted.find((cn) => cycleNodeIdSet.has(cn.id))?.executionOrder || 999)
    );
    const inCycleNodes = sorted.filter((n) => cycleNodeIdSet.has(n.id));
    const postCycleNodes = sorted.filter(
      (n) => !cycleNodeIdSet.has(n.id) && !preCycleNodes.some((pn) => pn.id === n.id)
    );

    // Add pre-cycle nodes
    preCycleNodes.forEach((n) => {
      plan.push({
        nodeId: n.id,
        iteration: 1,
        isCycleStep: false,
        stepSequence: seq++,
      });
    });

    // Add iterative cycle loops
    for (let iter = 1; iter <= maxLoopIterations; iter++) {
      inCycleNodes.forEach((n) => {
        plan.push({
          nodeId: n.id,
          iteration: iter,
          isCycleStep: true,
          stepSequence: seq++,
        });
      });
    }

    // Add post-cycle downstream nodes
    postCycleNodes.forEach((n) => {
      plan.push({
        nodeId: n.id,
        iteration: 1,
        isCycleStep: false,
        stepSequence: seq++,
      });
    });

    return plan.length > 0
      ? plan
      : sorted.map((n, i) => ({
          nodeId: n.id,
          iteration: 1,
          isCycleStep: false,
          stepSequence: i + 1,
        }));
  }, [pipeline.nodes, cycleAnalysis, executionMode, maxLoopIterations]);

  useEffect(() => {
    if (isOpen) {
      // Reset runner state on open
      setCurrentStepIndex(0);
      setCompletedSteps([]);
      setCurrentIteration(1);
      setLogs([
        {
          id: `log-init`,
          timestamp: new Date().toLocaleTimeString(),
          nodeId: 'pipeline-init',
          nodeName: pipeline.name,
          level: 'info',
          message: cycleAnalysis.hasCycle
            ? `Pipeline initialized. Circular dependency detected (${cycleAnalysis.cyclePaths[0]?.summary}). Iterative cycle loop execution mode active (${maxLoopIterations} maximum iterations).`
            : `Pipeline '${pipeline.name}' initialized for linear SAP HANA Cloud execution simulation.`,
        },
      ]);
      setIsRunning(false);
    }
  }, [isOpen, pipeline, cycleAnalysis.hasCycle, maxLoopIterations]);

  // Step-by-step runner timer
  useEffect(() => {
    let timer: any = null;
    if (isRunning && currentStepIndex < executionPlan.length) {
      const step = executionPlan[currentStepIndex];
      const node = pipeline.nodes.find((n) => n.id === step.nodeId);

      if (!node) {
        setCurrentStepIndex((prev) => prev + 1);
        return;
      }

      timer = setTimeout(() => {
        const hasError = node.validationSummary && !node.validationSummary.isValid;

        // Check if in strict mode and encountering a cycle
        if (executionMode === 'strict' && step.isCycleStep && cycleAnalysis.hasCycle) {
          const cycleLog: ExecutionLog = {
            id: `log-cycle-err-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            nodeId: node.id,
            nodeName: node.name,
            level: 'error',
            message: `[Strict Mode Execution Blocked] Circular dependency cycle detected at Step #${node.executionOrder} (${cycleAnalysis.cyclePaths[0]?.summary}). Switch to 'Iterative Loop' mode to execute cyclic queries.`,
          };
          setLogs((prev) => [...prev, cycleLog]);
          setIsRunning(false);
          return;
        }

        const durationMs = Math.floor(Math.random() * 60) + 30;
        const rows = Math.floor(Math.random() * 2000) + 200;

        setCurrentIteration(step.iteration);

        const iterationText = step.isCycleStep ? ` (Iteration ${step.iteration} of ${maxLoopIterations})` : '';

        const newLog: ExecutionLog = {
          id: `log-${node.id}-${step.iteration}-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          nodeId: node.id,
          nodeName: node.name,
          level: hasError ? 'error' : 'success',
          message: hasError
            ? `Query Step #${node.executionOrder}${iterationText} failed due to SAP HANA syntax diagnostic errors.`
            : `Query Step #${node.executionOrder} (${node.name})${iterationText} executed successfully. Affected rows: ${rows}, In-Memory Duration: ${durationMs}ms.`,
          durationMs,
          rowsAffected: rows,
        };

        // If completing the last step of an iteration, add a loop transition log
        const isLastInCycle =
          step.isCycleStep &&
          currentStepIndex + 1 < executionPlan.length &&
          executionPlan[currentStepIndex + 1].iteration > step.iteration;

        const loopLog: ExecutionLog | null = isLastInCycle
          ? {
              id: `log-loop-trans-${Date.now()}`,
              timestamp: new Date().toLocaleTimeString(),
              nodeId: 'loop-transition',
              nodeName: 'Cycle Engine',
              level: 'info',
              message: `🔁 [Loop Cycle] Iteration ${step.iteration} completed. Cycling back along loop edge to iteration ${
                step.iteration + 1
              }/${maxLoopIterations}...`,
            }
          : null;

        setLogs((prev) => (loopLog ? [...prev, newLog, loopLog] : [...prev, newLog]));
        setCompletedSteps((prev) => [...prev, step]);

        if (hasError) {
          setIsRunning(false);
        } else {
          setCurrentStepIndex((prev) => prev + 1);
        }
      }, 650);
    } else if (currentStepIndex >= executionPlan.length && isRunning && executionPlan.length > 0) {
      setIsRunning(false);
      const isCycleExec = cycleAnalysis.hasCycle && executionMode === 'iterative';
      setLogs((prev) => [
        ...prev,
        {
          id: `log-complete`,
          timestamp: new Date().toLocaleTimeString(),
          nodeId: 'pipeline-finish',
          nodeName: pipeline.name,
          level: 'success',
          message: isCycleExec
            ? `All ${executionPlan.length} execution steps (${maxLoopIterations} cycle iterations) completed successfully! All recursive target data marts materialized.`
            : `All ${executionPlan.length} sequence steps executed successfully! Target data marts materialized.`,
        },
      ]);
    }

    return () => clearTimeout(timer);
  }, [
    isRunning,
    currentStepIndex,
    executionPlan,
    pipeline.nodes,
    pipeline.name,
    executionMode,
    maxLoopIterations,
    cycleAnalysis,
  ]);

  if (!isOpen) return null;

  const totalSteps = executionPlan.length;
  const progressPercent = totalSteps > 0 ? Math.min(100, Math.round((completedSteps.length / totalSteps) * 100)) : 0;

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
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base text-slate-900">{pipeline.name}</h3>
                {cycleAnalysis.hasCycle && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-300">
                    <RefreshCw className="w-3 h-3 text-amber-600 animate-spin" style={{ animationDuration: '6s' }} />
                    <span>Cyclic Loop Active</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">SAP HANA Pipeline Execution & Cyclic Loop Simulator</p>
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
                  if (currentStepIndex >= executionPlan.length) {
                    setCurrentStepIndex(0);
                    setCompletedSteps([]);
                  }
                  setIsRunning(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#e20074] hover:bg-[#c70066] text-white rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer active:scale-95"
              >
                <Play className="w-4 h-4" />
                <span>{currentStepIndex >= executionPlan.length ? 'Re-Run Flow' : 'Start Flow Execution'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsRunning(false)}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer"
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
                setCompletedSteps([]);
                setLogs([]);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium transition-colors border border-slate-200 shadow-sm cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>

          {/* Progress Bar & Status */}
          <div className="flex-1 max-w-xs w-full space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">
                Step {completedSteps.length} of {totalSteps}
                {cycleAnalysis.hasCycle && ` (Iter ${currentIteration}/${maxLoopIterations})`}
              </span>
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
        <div className="flex items-center justify-between px-6 pt-3 border-b border-slate-200 bg-white text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('progress')}
              className={`pb-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === 'progress'
                  ? 'border-[#e20074] text-[#e20074] font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Sequence Steps Progression ({executionPlan.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              className={`pb-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'logs'
                  ? 'border-[#e20074] text-[#e20074] font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Execution Logs ({logs.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className={`pb-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'config'
                  ? 'border-[#e20074] text-[#e20074] font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>Cycle Settings {cycleAnalysis.hasCycle && '(Configured)'}</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
          {activeTab === 'progress' ? (
            <div className="space-y-3">
              {executionPlan.map((step, idx) => {
                const node = pipeline.nodes.find((n) => n.id === step.nodeId);
                if (!node) return null;
                const isCompleted = completedSteps.some(
                  (cs) => cs.nodeId === step.nodeId && cs.iteration === step.iteration
                );
                const isCurrent = isRunning && currentStepIndex === idx;

                return (
                  <div
                    key={`${step.nodeId}-iter-${step.iteration}-${idx}`}
                    onClick={() => {
                      onClose();
                      onSelectNode(node);
                    }}
                    className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all shadow-sm ${
                      isCompleted
                        ? 'bg-emerald-50 border-emerald-200 text-slate-800'
                        : isCurrent
                        ? 'bg-[#fdf0f6] border-[#e20074] ring-2 ring-[#f8b4d9] text-slate-900'
                        : step.isCycleStep
                        ? 'bg-amber-50/40 border-amber-200 hover:border-amber-400 text-slate-700'
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
                          step.stepSequence
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-slate-900">{node.name}</span>
                          <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">
                            {node.queryType}
                          </span>
                          {step.isCycleStep && (
                            <span className="text-[10px] font-semibold bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded border border-amber-300 flex items-center gap-1 font-mono">
                              <Repeat className="w-2.5 h-2.5 text-amber-700" />
                              <span>Iter #{step.iteration}</span>
                            </span>
                          )}
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
          ) : activeTab === 'logs' ? (
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
          ) : (
            /* Cycle Settings Tab */
            <div className="space-y-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                  <Sliders className="w-4 h-4 text-[#e20074]" />
                  <span>Cycle & Loop Execution Policy</span>
                </div>

                {cycleAnalysis.hasCycle ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                      <span>Graph contains circular dependencies:</span>
                    </div>
                    <p className="font-mono text-[11px] text-amber-800">{cycleAnalysis.cyclePaths[0]?.summary}</p>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-center gap-2">
                    <Info className="w-4 h-4 text-slate-400" />
                    <span>No circular cycles detected in graph. The flow executes as a linear DAG.</span>
                  </div>
                )}

                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Execution Mode</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setExecutionMode('iterative')}
                        className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                          executionMode === 'iterative'
                            ? 'border-[#e20074] bg-[#fdf0f6] ring-1 ring-[#e20074]'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="font-semibold text-xs text-slate-900 flex items-center gap-1.5">
                          <Repeat className="w-3.5 h-3.5 text-[#e20074]" />
                          <span>Iterative Loop Execution</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Executes cyclic query nodes iteratively up to the max loop count limit.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setExecutionMode('strict')}
                        className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                          executionMode === 'strict'
                            ? 'border-[#e20074] bg-[#fdf0f6] ring-1 ring-[#e20074]'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="font-semibold text-xs text-slate-900 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                          <span>Strict DAG Mode</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Enforces strict linear ordering. Aborts simulation if a cycle is encountered.
                        </p>
                      </button>
                    </div>
                  </div>

                  {executionMode === 'iterative' && (
                    <div className="pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-slate-700">Maximum Loop Iterations</label>
                        <span className="font-mono text-xs font-bold text-[#e20074]">{maxLoopIterations} iterations</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={maxLoopIterations}
                        onChange={(e) => setMaxLoopIterations(parseInt(e.target.value, 10))}
                        className="w-full accent-[#e20074] cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
                        <span>1 (Single pass)</span>
                        <span>3 (Standard)</span>
                        <span>5 (Deep recursion)</span>
                        <span>10 (Max)</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export type QueryType =
  | 'DDL'
  | 'DML'
  | 'UPSERT'
  | 'SELECT'
  | 'SQLSCRIPT'
  | 'TRANSFORM'
  | 'AGGREGATION';

export type NodeStatus = 'idle' | 'running' | 'success' | 'error' | 'warning';

export interface QueryParameter {
  name: string;
  type: string;
  defaultValue: string;
  description?: string;
}

export interface SimulatedOutput {
  columns: string[];
  rows: Record<string, any>[];
  affectedRows: number;
  executionTimeMs: number;
  memoryUsageMb: number;
  timestamp: string;
}

export interface SyntaxDiagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  ruleId: string;
  suggestedFix?: string;
  codeSnippet?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errorCount: number;
  warningCount: number;
  diagnostics: SyntaxDiagnostic[];
  extractedTables: {
    inputs: string[];
    outputs: string[];
  };
  extractedParams: QueryParameter[];
  dialectScore: number;
}

export interface SQLNode {
  id: string;
  name: string;
  description: string;
  queryType: QueryType;
  sqlContent: string;
  targetSchema?: string;
  targetTable?: string;
  inputTables: string[];
  parameters: QueryParameter[];
  executionOrder: number;
  status: NodeStatus;
  enabled: boolean;
  position: { x: number; y: number };
  nextNodeIds: string[];
  documentation?: string;
  simulatedOutput?: SimulatedOutput;
  lastValidated?: string;
  validationSummary?: {
    isValid: boolean;
    errors: number;
    warnings: number;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface FlowPipeline {
  id: string;
  name: string;
  description: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  nodes: SQLNode[];
  edges: FlowEdge[];
  author?: string;
  targetHanaVersion?: string;
}

export interface ExecutionLog {
  id: string;
  timestamp: string;
  nodeId: string;
  nodeName: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  durationMs?: number;
  rowsAffected?: number;
}

export interface PipelineExecutionState {
  isRunning: boolean;
  isPaused: boolean;
  currentNodeId: string | null;
  currentStepIndex: number;
  totalSteps: number;
  progressPercent: number;
  logs: ExecutionLog[];
  completedNodeIds: string[];
  failedNodeIds: string[];
  startTime?: number;
  endTime?: number;
}

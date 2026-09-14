import React, { useState } from 'react';
import { FlowPipeline, SQLNode, RecurrenceSchedule } from '../types';
import {
  INITIAL_INDEPENDENT_SCHEDULES,
  findScheduleById,
  getShortScheduleLabel
} from '../utils/scheduleUtils';
import {
  Code2,
  CheckSquare,
  Square,
  GitBranch,
  Plus,
  Trash2,
  Edit2,
  Check,
  Search,
  Layers,
  Terminal,
  FileText,
  FileCode,
  BookOpen,
  Play,
  Download,
  Clock
} from 'lucide-react';

interface SqlStatementListProps {
  pipeline: FlowPipeline;
  selectedNodeIds: string[];
  onToggleSelectNode: (nodeId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onShowGraph: () => void;
  onOpenEditor: (node: SQLNode) => void;
  onToggleNodeActive: (nodeId: string, active: boolean) => void;
  onUpdateNodeDescription: (nodeId: string, description: string) => void;
  onAddNode: () => void;
  onDeleteNode: (nodeId: string) => void;
  onOpenDocumentation: (node: SQLNode) => void;
  allPipelines: FlowPipeline[];
  onSelectPipeline: (pipelineId: string) => void;
  onNewPipeline: () => void;
  isGraphShowing?: boolean;
  onRunSimulation?: () => void;
  onExport?: () => void;
  onOpenRecurrenceScreen?: (node?: SQLNode) => void;
  schedules?: RecurrenceSchedule[];
  onAssignScheduleToNode?: (nodeId: string, scheduleId: string) => void;
}

export const SqlStatementList: React.FC<SqlStatementListProps> = ({
  pipeline,
  selectedNodeIds,
  onToggleSelectNode,
  onSelectAll,
  onDeselectAll,
  onShowGraph,
  onOpenEditor,
  onToggleNodeActive,
  onUpdateNodeDescription,
  onAddNode,
  onDeleteNode,
  onOpenDocumentation,
  allPipelines,
  onSelectPipeline,
  onNewPipeline,
  isGraphShowing,
  onRunSimulation,
  onExport,
  onOpenRecurrenceScreen,
  schedules = [],
  onAssignScheduleToNode,
}) => {
  const allSchedules = [...INITIAL_INDEPENDENT_SCHEDULES, ...schedules.filter(s => !INITIAL_INDEPENDENT_SCHEDULES.some(i => i.id === s.id))];
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [descInputValue, setDescInputValue] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const nodes = pipeline.nodes || [];

  const filteredNodes = nodes.filter((node) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      node.name.toLowerCase().includes(q) ||
      (node.description && node.description.toLowerCase().includes(q)) ||
      node.sqlContent.toLowerCase().includes(q) ||
      (node.targetTable && node.targetTable.toLowerCase().includes(q))
    );
  });

  const selectedCount = selectedNodeIds.length;
  const canShowGraph = selectedCount >= 2;
  const isAllSelected = nodes.length > 0 && selectedCount === nodes.length;

  const startEditingDesc = (node: SQLNode) => {
    setEditingDescId(node.id);
    setDescInputValue(node.description || '');
  };

  const saveEditingDesc = (nodeId: string) => {
    onUpdateNodeDescription(nodeId, descInputValue);
    setEditingDescId(null);
  };

  return (
    <div className="flex flex-col h-full w-full bg-white border-r border-slate-200 overflow-hidden select-none">
      {/* Header Bar: Pipeline Selector, Quick Actions, Search & Show Graph */}
      <div className="p-3 sm:p-4 bg-white border-b border-slate-200 shadow-2xs flex flex-col gap-3 shrink-0">
        {/* Top Header Row */}
        <div className="flex items-center justify-between gap-2">
          {/* Pipeline Selector Dropdown */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#e20074] text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Pipeline Dataset
              </span>
              <div className="flex items-center gap-1.5">
                <select
                  value={pipeline.id}
                  onChange={(e) => onSelectPipeline(e.target.value)}
                  className="bg-slate-100 hover:bg-slate-200/70 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-[#e20074] cursor-pointer max-w-[210px] truncate"
                >
                  {allPipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.nodes.length} SQLs)
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onNewPipeline}
                  className="p-1.5 bg-slate-100 hover:bg-[#fdf0f6] text-slate-600 hover:text-[#c70066] border border-slate-200 hover:border-[#f8b4d9] rounded-lg transition-colors cursor-pointer"
                  title="Create New Pipeline"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2">
            {/* Quick Add SQL Statement */}
            <button
              type="button"
              onClick={onAddNode}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add SQL</span>
            </button>

            {onOpenRecurrenceScreen && (
              <button
                type="button"
                onClick={() => onOpenRecurrenceScreen()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer shrink-0"
                title="Configure execution recurrence schedules for SQL statements"
              >
                <Clock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Recurrence</span>
              </button>
            )}

            {onRunSimulation && (
              <button
                type="button"
                onClick={onRunSimulation}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer shrink-0"
                title="Run test simulation on SQL statements"
              >
                <Play className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Run Test</span>
              </button>
            )}

            {onExport && (
              <button
                type="button"
                onClick={onExport}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold border border-slate-300 transition-colors cursor-pointer shrink-0"
                title="Export SQL artifacts"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Export</span>
              </button>
            )}
          </div>
        </div>

        {/* Action Controls & Show Graph Trigger Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={isAllSelected ? onDeselectAll : onSelectAll}
              className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
            >
              {isAllSelected ? (
                <CheckSquare className="w-4 h-4 text-[#e20074]" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span>{isAllSelected ? 'Deselect All' : 'Select All'}</span>
            </button>
            <span className="text-slate-300">|</span>
            <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
              {selectedCount} of {nodes.length} selected
            </span>
          </div>

          {/* SHOW GRAPH BUTTON */}
          <button
            type="button"
            onClick={onShowGraph}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer shadow-sm ${
              isGraphShowing
                ? 'bg-[#e20074] text-white ring-2 ring-[#f8b4d9]'
                : canShowGraph
                ? 'bg-[#e20074] hover:bg-[#c70066] text-white shadow-md hover:shadow-lg'
                : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
            }`}
            title={
              canShowGraph
                ? 'Render dependency flow graph for selected SQL statements'
                : 'Select at least 2 SQL statements to view graph'
            }
          >
            <GitBranch className="w-4 h-4" />
            <span>Show Graph</span>
            {selectedCount > 0 && (
              <span className="bg-white/20 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                {selectedCount}
              </span>
            )}
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter SQL statements by name, code, description..."
            className="w-full bg-slate-100 focus:bg-white text-xs border border-slate-200 focus:border-[#e20074] rounded-lg pl-8 pr-3 py-1.5 outline-none transition-colors"
          />
        </div>
      </div>

      {/* Full-Screen Table Container */}
      <div className="flex-1 overflow-x-auto overflow-y-auto w-full bg-white">
        <table className="w-full text-left border-collapse min-w-[700px]">
          {/* Table Header */}
          <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 shadow-2xs z-10 text-[11px] uppercase font-bold text-slate-600 tracking-wider">
            <tr>
              <th scope="col" className="py-3 px-3 w-10 text-center">
                <button
                  type="button"
                  onClick={isAllSelected ? onDeselectAll : onSelectAll}
                  className="text-slate-400 hover:text-[#e20074] transition-colors cursor-pointer"
                  title={isAllSelected ? 'Deselect All' : 'Select All'}
                >
                  {isAllSelected ? (
                    <CheckSquare className="w-4 h-4 text-[#e20074]" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400" />
                  )}
                </button>
              </th>
              <th scope="col" className="py-3 px-3 w-14 text-center">
                ID
              </th>
              <th scope="col" className="py-3 px-3 min-w-[180px]">
                SQL Statement Name
              </th>
              <th scope="col" className="py-3 px-3 min-w-[200px]">
                Description
              </th>
              <th scope="col" className="py-3 px-3 min-w-[170px]">
                Recurrence
              </th>
              <th scope="col" className="py-3 px-3 w-24 text-center">
                Active
              </th>
              <th scope="col" className="py-3 px-3 w-36 text-right pr-4">
                Actions
              </th>
            </tr>
          </thead>

          {/* Table Body Rows */}
          <tbody className="divide-y divide-slate-200/80 text-xs text-slate-800">
            {filteredNodes.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <FileCode className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-semibold text-slate-600 text-sm">No SQL statements found</p>
                  <p className="text-xs text-slate-400 mt-0.5">Try resetting search filter or add a new statement.</p>
                </td>
              </tr>
            ) : (
              filteredNodes.map((node, index) => {
                const numericId = node.executionOrder || index + 1;
                const isSelected = selectedNodeIds.includes(node.id);
                const isEditingDesc = editingDescId === node.id;

                return (
                  <tr
                    key={node.id}
                    className={`transition-colors group hover:bg-slate-50/90 ${
                      isSelected ? 'bg-[#fdf0f6]/40' : index % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'
                    } ${!node.enabled ? 'opacity-60' : ''}`}
                  >
                    {/* Checkbox Column */}
                    <td className="py-3 px-3 text-center align-top pt-3.5">
                      <button
                        type="button"
                        onClick={() => onToggleSelectNode(node.id)}
                        className="text-slate-400 hover:text-[#e20074] transition-colors cursor-pointer"
                        title={isSelected ? 'Deselect statement' : 'Select statement for graph'}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#e20074]" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300 group-hover:text-slate-400" />
                        )}
                      </button>
                    </td>

                    {/* Numeric ID Column */}
                    <td className="py-3 px-3 text-center align-top pt-3">
                      <span className="inline-block px-2 py-0.5 bg-slate-900 text-white font-mono font-bold text-[11px] rounded shadow-2xs">
                        #{numericId}
                      </span>
                    </td>

                    {/* SQL Statement Name & Query Type Column */}
                    <td className="py-3 px-3 align-top">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-slate-900 text-xs font-mono">
                            {node.name}
                          </span>
                          <span className="bg-slate-100 text-slate-700 text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border border-slate-200 uppercase">
                            {node.queryType || 'SELECT'}
                          </span>
                        </div>

                        {node.targetTable && (
                          <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1 truncate">
                            <span>Target:</span>
                            <span className="text-slate-700 font-semibold bg-slate-100 px-1 rounded border border-slate-200 truncate">
                              {node.targetSchema ? `"${node.targetSchema}"."${node.targetTable}"` : node.targetTable}
                            </span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Description Column (Editable Inline) */}
                    <td className="py-3 px-3 align-top">
                      {isEditingDesc ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={descInputValue}
                            onChange={(e) => setDescInputValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditingDesc(node.id);
                              if (e.key === 'Escape') setEditingDescId(null);
                            }}
                            autoFocus
                            className="w-full bg-white border border-[#e20074] rounded px-2 py-1 text-xs text-slate-900 outline-none"
                            placeholder="Statement description..."
                          />
                          <button
                            type="button"
                            onClick={() => saveEditingDesc(node.id)}
                            className="p-1 bg-[#e20074] text-white rounded text-xs hover:bg-[#c70066] transition-colors cursor-pointer shrink-0"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div
                          onClick={() => startEditingDesc(node)}
                          className="group/desc flex items-start gap-1.5 text-slate-600 hover:text-slate-900 cursor-pointer py-0.5 rounded px-1 -ml-1 hover:bg-slate-200/50 transition-colors"
                          title="Click to edit description"
                        >
                          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                          <span className="italic flex-1 leading-snug line-clamp-2">
                            {node.description || 'No description. Click to add.'}
                          </span>
                          <Edit2 className="w-3 h-3 text-slate-400 opacity-0 group-hover/desc:opacity-100 transition-opacity shrink-0 mt-0.5" />
                        </div>
                      )}
                    </td>

                    {/* Recurrence Column */}
                    <td className="py-3 px-3 align-top">
                      <div className="flex items-center gap-1">
                        <select
                          value={node.scheduleId || 'SCHED-DAILY-6AM'}
                          onChange={(e) => {
                            if (onAssignScheduleToNode) {
                              onAssignScheduleToNode(node.id, e.target.value);
                            }
                          }}
                          className="bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-800 rounded-lg px-2 py-1 text-xs font-medium outline-none focus:ring-1 focus:ring-[#e20074] cursor-pointer max-w-[140px] truncate"
                          title="Assign independent Recurrence Schedule ID"
                        >
                          {allSchedules.map((s) => (
                            <option key={s.id} value={s.id}>
                              [{s.id}] {getShortScheduleLabel(s)}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => onOpenRecurrenceScreen && onOpenRecurrenceScreen(node)}
                          className="p-1.5 text-slate-400 hover:text-[#e20074] hover:bg-[#fdf0f6] rounded-lg transition-colors cursor-pointer shrink-0"
                          title="Configure independent recurrence schedules & assignments"
                        >
                          <Clock className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* Active Switch Column */}
                    <td className="py-3 px-3 text-center align-top pt-3">
                      <div
                        onClick={() => onToggleNodeActive(node.id, !node.enabled)}
                        className={`inline-flex w-9 h-5 items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                          node.enabled ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                        title={node.enabled ? 'Active (Click to disable)' : 'Inactive (Click to activate)'}
                      >
                        <div
                          className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                            node.enabled ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </div>
                    </td>

                    {/* Actions Column */}
                    <td className="py-3 px-3 text-right align-top pt-2.5 pr-4">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* OPEN SQL EDITOR BUTTON */}
                        <button
                          type="button"
                          onClick={() => onOpenEditor(node)}
                          className="flex items-center gap-1 px-2.5 py-1 bg-[#fdf0f6] text-[#c70066] hover:bg-[#e20074] hover:text-white border border-[#f8b4d9] rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer shrink-0"
                          title="Open in SAP HANA SQL Editor"
                        >
                          <Code2 className="w-3.5 h-3.5" />
                          <span>Edit SQL</span>
                        </button>

                        {/* Open Technical Documentation */}
                        <button
                          type="button"
                          onClick={() => onOpenDocumentation(node)}
                          className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer"
                          title="View Technical Documentation"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Node */}
                        <button
                          type="button"
                          onClick={() => onDeleteNode(node.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete Statement"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Status Bar */}
      <div className="p-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between px-4 shrink-0">
        <span className="flex items-center gap-1.5 font-medium">
          <Terminal className="w-3.5 h-3.5 text-[#e20074]" />
          <span>SAP HANA Pipeline Engine</span>
        </span>
        <span className="font-mono text-slate-500 font-bold">
          {nodes.filter((n) => n.enabled).length} of {nodes.length} Active SQLs
        </span>
      </div>
    </div>
  );
};

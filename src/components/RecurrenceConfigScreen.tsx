import React, { useState } from 'react';
import { FlowPipeline, SQLNode, RecurrenceType, RecurrenceSchedule } from '../types';
import {
  RECURRENCE_OPTIONS,
  getPresetConfig,
  getScheduleLabel,
  getNextExecutions,
  getShortScheduleLabel,
  findScheduleById,
  INITIAL_INDEPENDENT_SCHEDULES
} from '../utils/scheduleUtils';
import {
  Clock,
  Plus,
  ArrowLeft,
  Check,
  Save,
  Layers,
  Trash2,
  Edit3,
  Calendar,
  Zap,
  RotateCw,
  Sliders,
  CheckSquare,
  Square,
  Tag,
  List
} from 'lucide-react';

interface RecurrenceConfigScreenProps {
  pipeline: FlowPipeline;
  selectedNodeId?: string | null;
  schedules: RecurrenceSchedule[];
  onCreateSchedule: (schedule: RecurrenceSchedule) => void;
  onUpdateSchedule: (schedule: RecurrenceSchedule) => void;
  onDeleteSchedule: (scheduleId: string) => void;
  onAssignScheduleToNode: (nodeId: string, scheduleId: string) => void;
  onAssignScheduleToAllNodes: (scheduleId: string) => void;
  onClose: () => void;
  allPipelines: FlowPipeline[];
  onSelectPipeline: (pipelineId: string) => void;
}

export const RecurrenceConfigScreen: React.FC<RecurrenceConfigScreenProps> = ({
  pipeline,
  selectedNodeId,
  schedules,
  onCreateSchedule,
  onUpdateSchedule,
  onDeleteSchedule,
  onAssignScheduleToNode,
  onAssignScheduleToAllNodes,
  onClose,
  allPipelines,
  onSelectPipeline,
}) => {
  const nodes = pipeline.nodes || [];
  const allSchedules = [...INITIAL_INDEPENDENT_SCHEDULES, ...schedules.filter(s => !INITIAL_INDEPENDENT_SCHEDULES.some(i => i.id === s.id))];

  // Active view mode: 'schedules' (Manage independent schedules) or 'assign' (Assign schedules to SELECT statements)
  const [activeTab, setActiveTab] = useState<'schedules' | 'assign'>('schedules');

  // Currently selected schedule ID for editing
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(() => {
    // If a node was targeted, pre-select its scheduleId
    if (selectedNodeId) {
      const targetNode = nodes.find(n => n.id === selectedNodeId);
      if (targetNode?.scheduleId) return targetNode.scheduleId;
    }
    return allSchedules[3]?.id || 'SCHED-DAILY-6AM';
  });

  // State for Schedule Creation or Editing
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [formSchedule, setFormSchedule] = useState<RecurrenceSchedule>(() => {
    const initial = findScheduleById(editingScheduleId || 'SCHED-DAILY-6AM', schedules) || allSchedules[3];
    return { ...initial };
  });

  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);

  // Sync form schedule when editingScheduleId changes
  const handleSelectScheduleForEdit = (schedId: string) => {
    setIsCreatingNew(false);
    setEditingScheduleId(schedId);
    const found = findScheduleById(schedId, schedules) || allSchedules.find(s => s.id === schedId);
    if (found) {
      setFormSchedule({ ...found });
    }
  };

  const handleStartCreateNew = () => {
    const newId = `SCHED-CUSTOM-${Math.floor(1000 + Math.random() * 9000)}`;
    setIsCreatingNew(true);
    setEditingScheduleId(newId);
    setFormSchedule({
      id: newId,
      name: 'Custom Execution Schedule',
      description: 'Independent schedule configured for target SELECT statements',
      type: 'AT_6AM',
      customCron: '0 6 * * *',
      timeOfDay: '06:00',
      daysOfWeek: [1],
      dayOfMonth: 1,
      timezone: 'UTC',
      maxRetries: 3,
      timeoutSeconds: 300,
      concurrencyPolicy: 'SKIP',
    });
  };

  const handleSaveFormSchedule = () => {
    if (!formSchedule.id.trim() || !formSchedule.name.trim()) {
      alert('Please enter a valid unique Schedule ID and Schedule Name.');
      return;
    }

    if (isCreatingNew) {
      onCreateSchedule(formSchedule);
      setIsCreatingNew(false);
      setEditingScheduleId(formSchedule.id);
      setSavedFeedback(`Created independent recurrence schedule "${formSchedule.name}" [${formSchedule.id}]!`);
    } else {
      onUpdateSchedule(formSchedule);
      setSavedFeedback(`Updated schedule "${formSchedule.name}" [${formSchedule.id}]!`);
    }

    setTimeout(() => setSavedFeedback(null), 3000);
  };

  const handleDeleteCurrentSchedule = (id: string) => {
    const isSys = INITIAL_INDEPENDENT_SCHEDULES.some(s => s.id === id);
    if (isSys) {
      alert('System default recurrence schedules cannot be deleted.');
      return;
    }

    if (window.confirm(`Delete independent recurrence schedule "${id}"? Statements assigned to it will revert to SCHED-DAILY-6AM.`)) {
      onDeleteSchedule(id);
      const fallback = 'SCHED-DAILY-6AM';
      setEditingScheduleId(fallback);
      const found = findScheduleById(fallback, schedules) || INITIAL_INDEPENDENT_SCHEDULES[3];
      setFormSchedule({ ...found });
      setSavedFeedback(`Deleted schedule ${id}`);
      setTimeout(() => setSavedFeedback(null), 3000);
    }
  };

  const handleToggleNodeAssignment = (nodeId: string, currentScheduleId?: string) => {
    const targetScheduleId = formSchedule.id;
    if (currentScheduleId === targetScheduleId) {
      // Unassign: reset to default
      onAssignScheduleToNode(nodeId, 'SCHED-DAILY-6AM');
    } else {
      // Assign
      onAssignScheduleToNode(nodeId, targetScheduleId);
    }
  };

  const handleSelectPresetType = (type: RecurrenceType) => {
    const preset = getPresetConfig(type);
    setFormSchedule(prev => ({
      ...prev,
      type: preset.type,
      customCron: preset.customCron,
      timeOfDay: preset.timeOfDay || prev.timeOfDay,
      daysOfWeek: preset.daysOfWeek || prev.daysOfWeek,
      dayOfMonth: preset.dayOfMonth || prev.dayOfMonth,
    }));
  };

  const daysOfWeekMap = [
    { id: 1, label: 'Mon' },
    { id: 2, label: 'Tue' },
    { id: 3, label: 'Wed' },
    { id: 4, label: 'Thu' },
    { id: 5, label: 'Fri' },
    { id: 6, label: 'Sat' },
    { id: 0, label: 'Sun' },
  ];

  const toggleDayOfWeek = (dayId: number) => {
    const currentDays = formSchedule.daysOfWeek || [1];
    let newDays: number[];
    if (currentDays.includes(dayId)) {
      if (currentDays.length === 1) return;
      newDays = currentDays.filter((d) => d !== dayId);
    } else {
      newDays = [...currentDays, dayId].sort();
    }
    setFormSchedule(prev => ({
      ...prev,
      daysOfWeek: newDays,
      type: 'CUSTOM'
    }));
  };

  const nextExecutionDates = getNextExecutions(formSchedule, 5);

  return (
    <div className="flex flex-col h-full w-full bg-slate-900 text-slate-100 overflow-hidden font-sans">
      {/* Top Header Navigation */}
      <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#e20074] hover:bg-[#c70066] text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Statements Table</span>
          </button>

          <div className="h-5 w-px bg-slate-700 hidden sm:block" />

          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-slate-700 text-[#f8b4d9] rounded-lg">
              <Clock className="w-5 h-5 text-[#e20074]" />
            </div>
            <div>
              <h1 className="font-bold text-sm text-white flex items-center gap-2">
                <span>Independent Recurrence Schedule Manager</span>
              </h1>
              <span className="text-[11px] text-slate-400 font-mono">
                Pipeline: <strong className="text-slate-200">{pipeline.name}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* View Tabs & Pipeline Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-700">
            <button
              type="button"
              onClick={() => setActiveTab('schedules')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                activeTab === 'schedules'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Independent Schedules ({allSchedules.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('assign')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                activeTab === 'assign'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Statement Assignments ({nodes.length})</span>
            </button>
          </div>

          <div className="h-5 w-px bg-slate-700 hidden sm:block" />

          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={pipeline.id}
              onChange={(e) => onSelectPipeline(e.target.value)}
              className="bg-slate-700 border border-slate-600 text-white rounded-lg px-2.5 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#e20074] cursor-pointer"
            >
              {allPipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Body */}
      {activeTab === 'schedules' ? (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left Sidebar: Independent Schedule Directory */}
          <div className="w-full md:w-80 bg-slate-800/80 border-r border-slate-700 flex flex-col shrink-0 overflow-hidden">
            <div className="p-3 border-b border-slate-700/80 bg-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Configured Schedules
                </h2>
                <p className="text-[11px] text-slate-400">Independent Recurrence Profiles</p>
              </div>

              <button
                type="button"
                onClick={handleStartCreateNew}
                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer"
                title="Create a new independent recurrence schedule profile with a unique ID"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
            </div>

            {/* List of Schedules */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
              {allSchedules.map((sched) => {
                const isSelected = formSchedule.id === sched.id && !isCreatingNew;
                const assignedCount = nodes.filter(
                  (n) => (n.scheduleId || 'SCHED-DAILY-6AM') === sched.id
                ).length;

                return (
                  <div
                    key={sched.id}
                    onClick={() => handleSelectScheduleForEdit(sched.id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-950/80 border-indigo-500 shadow-md ring-1 ring-indigo-500/50'
                        : 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        {sched.id}
                      </span>
                      {sched.isSystemDefault && (
                        <span className="text-[9px] uppercase font-bold text-slate-400 bg-slate-700/50 px-1.5 py-0.5 rounded">
                          System Default
                        </span>
                      )}
                    </div>

                    <h3 className="text-xs font-bold text-white truncate mb-1">
                      {sched.name}
                    </h3>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
                      <span className="font-mono text-[10px] text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700">
                        {sched.customCron || '0 6 * * *'}
                      </span>
                      <span className="text-[10px] font-bold text-indigo-300 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                        {assignedCount} {assignedCount === 1 ? 'Statement' : 'Statements'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Main Editor: Configure Selected Independent Schedule */}
          <div className="flex-1 overflow-y-auto p-6 bg-slate-900 space-y-6 custom-scrollbar">
            {savedFeedback && (
              <div className="p-3 bg-emerald-900/50 border border-emerald-500/50 text-emerald-200 rounded-xl text-xs font-bold flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>{savedFeedback}</span>
              </div>
            )}

            {/* Schedule Identification Card */}
            <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-700">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
                    <Tag className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-bold text-base text-white">
                      {isCreatingNew ? 'Create New Independent Recurrence Schedule' : `Edit Schedule: ${formSchedule.name}`}
                    </h2>
                    <p className="text-xs text-slate-400">
                      Unique Recurrence Profile assigned to SELECT statements
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!isCreatingNew && !formSchedule.isSystemDefault && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCurrentSchedule(formSchedule.id)}
                      className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 rounded-xl border border-rose-900/50 transition-colors cursor-pointer"
                      title="Delete this custom schedule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleSaveFormSchedule}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isCreatingNew ? 'Create Schedule' : 'Save Schedule Changes'}</span>
                  </button>
                </div>
              </div>

              {/* ID and Name Input Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                    <span>Unique Schedule ID</span>
                    <span className="text-[10px] text-slate-400 font-normal">Must be unique</span>
                  </label>
                  <input
                    type="text"
                    value={formSchedule.id}
                    onChange={(e) => setFormSchedule(prev => ({ ...prev, id: e.target.value.toUpperCase().replace(/\s+/g, '-') }))}
                    disabled={!isCreatingNew && formSchedule.isSystemDefault}
                    placeholder="e.g. SCHED-NIGHTLY-BATCH"
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-mono font-bold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Schedule Display Name
                  </label>
                  <input
                    type="text"
                    value={formSchedule.name}
                    onChange={(e) => setFormSchedule(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Nightly Inventory ETL (02:00 AM)"
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Description / Purpose Notes
                  </label>
                  <input
                    type="text"
                    value={formSchedule.description || ''}
                    onChange={(e) => setFormSchedule(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of when and why this recurrence runs..."
                    className="w-full bg-slate-900 border border-slate-700 text-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Recurrence Frequency & Cron Pattern Grid */}
            <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-lg space-y-5">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span>Recurrence Frequency Pattern</span>
              </h3>

              {/* Preset Buttons */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {RECURRENCE_OPTIONS.map((opt) => {
                  const isSelected = formSchedule.type === opt.type;
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => handleSelectPresetType(opt.type)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-indigo-900/60 border-indigo-500 text-white ring-1 ring-indigo-500/50 shadow-sm'
                          : 'bg-slate-900/60 border-slate-700/80 text-slate-300 hover:bg-slate-750 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs">{opt.shortLabel}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <span className="text-[10px] text-slate-400 line-clamp-2">{opt.description}</span>
                    </button>
                  );
                })}
              </div>

              {/* Custom Time & Day Configuration */}
              <div className="p-4 bg-slate-900/80 border border-slate-700/80 rounded-xl space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Time of Day */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Execution Time (UTC)</span>
                    </label>
                    <input
                      type="time"
                      value={formSchedule.timeOfDay || '06:00'}
                      onChange={(e) =>
                        setFormSchedule((prev) => ({
                          ...prev,
                          timeOfDay: e.target.value,
                        }))
                      }
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                    />
                  </div>

                  {/* Timezone */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Timezone</span>
                    </label>
                    <select
                      value={formSchedule.timezone || 'UTC'}
                      onChange={(e) =>
                        setFormSchedule((prev) => ({
                          ...prev,
                          timezone: e.target.value,
                        }))
                      }
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="UTC">UTC (Coordinated Universal Time)</option>
                      <option value="CET">CET (Central European Time / Berlin)</option>
                      <option value="EST">EST (Eastern Standard Time / NY)</option>
                      <option value="PST">PST (Pacific Standard Time / CA)</option>
                      <option value="SGT">SGT (Singapore Standard Time)</option>
                    </select>
                  </div>

                  {/* Cron Expression */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Cron Syntax</span>
                    </label>
                    <input
                      type="text"
                      value={formSchedule.customCron || '0 6 * * *'}
                      onChange={(e) =>
                        setFormSchedule((prev) => ({
                          ...prev,
                          customCron: e.target.value,
                        }))
                      }
                      className="w-full bg-slate-800 border border-slate-700 text-emerald-400 rounded-lg px-3 py-1.5 text-xs font-mono font-bold outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {/* Days of Week Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-2">
                    Active Recurrence Days
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {daysOfWeekMap.map((day) => {
                      const isSelected = (formSchedule.daysOfWeek || [1]).includes(day.id);
                      return (
                        <button
                          key={day.id}
                          type="button"
                          onClick={() => toggleDayOfWeek(day.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
                          }`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Next Executions Preview */}
              <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-700/60">
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <RotateCw className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Upcoming Execution Preview (Next 5 Runs)</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2">
                  {nextExecutionDates.map((dateStr, idx) => (
                    <div
                      key={idx}
                      className="p-2 bg-slate-800/80 rounded-lg border border-slate-700 text-center"
                    >
                      <span className="text-[10px] text-indigo-400 font-bold block mb-0.5">
                        Run #{idx + 1}
                      </span>
                      <span className="text-[11px] font-mono font-medium text-slate-200">
                        {dateStr}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Direct Statement Assignment Section for this Schedule */}
            <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-indigo-400" />
                    <span>Assign Schedule [{formSchedule.id}] to SELECT Statements</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Check statements in pipeline "{pipeline.name}" that should execute on this schedule
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onAssignScheduleToAllNodes(formSchedule.id)}
                  className="px-3 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  Assign to All Statements
                </button>
              </div>

              <div className="divide-y divide-slate-700/80 border border-slate-700 rounded-xl bg-slate-900/80 overflow-hidden">
                {nodes.map((node) => {
                  const currentSchedId = node.scheduleId || 'SCHED-DAILY-6AM';
                  const isAssigned = currentSchedId === formSchedule.id;

                  return (
                    <div
                      key={node.id}
                      onClick={() => handleToggleNodeAssignment(node.id, currentSchedId)}
                      className={`p-3.5 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                        isAssigned ? 'bg-indigo-950/40' : 'hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <button type="button" className="text-indigo-400">
                          {isAssigned ? (
                            <CheckSquare className="w-5 h-5 text-indigo-400" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-600" />
                          )}
                        </button>
                        <div>
                          <h4 className="text-xs font-bold text-white">{node.name}</h4>
                          <p className="text-[11px] text-slate-400 line-clamp-1">{node.description}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          Current: {currentSchedId}
                        </span>
                        {isAssigned && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                            Assigned
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Tab 2: Statement Assignment Matrix */
        <div className="flex-1 overflow-y-auto p-6 bg-slate-900 space-y-6 custom-scrollbar">
          <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-700">
              <div>
                <h2 className="font-bold text-base text-white flex items-center gap-2">
                  <List className="w-5 h-5 text-indigo-400" />
                  <span>SELECT Statements Recurrence Schedule Assignment</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Assign independent schedule profiles (by unique ID) to each SELECT statement in pipeline "{pipeline.name}"
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('schedules')}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Configure New Independent Schedule</span>
              </button>
            </div>

            {/* Statements Table */}
            <div className="overflow-x-auto border border-slate-700 rounded-xl bg-slate-900/90">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-800 text-slate-300 text-xs font-bold border-b border-slate-700">
                    <th className="py-3 px-4">Order</th>
                    <th className="py-3 px-4">Statement Name & Description</th>
                    <th className="py-3 px-4">Input Tables</th>
                    <th className="py-3 px-4">Assigned Schedule ID</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-xs text-slate-300">
                  {nodes.map((node, index) => {
                    const currentSchedId = node.scheduleId || 'SCHED-DAILY-6AM';
                    const activeSched = findScheduleById(currentSchedId, schedules) || allSchedules.find(s => s.id === currentSchedId);

                    return (
                      <tr key={node.id} className="hover:bg-slate-800/60 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-indigo-400">
                          #{index + 1}
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-bold text-white text-xs mb-0.5">{node.name}</div>
                          <div className="text-[11px] text-slate-400 max-w-md truncate">{node.description}</div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {node.inputTables.map((tbl, i) => (
                              <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                                {tbl.replace(/"/g, '')}
                              </span>
                            ))}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <select
                            value={currentSchedId}
                            onChange={(e) => onAssignScheduleToNode(node.id, e.target.value)}
                            className="bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer min-w-[200px]"
                          >
                            {allSchedules.map((s) => (
                              <option key={s.id} value={s.id}>
                                [{s.id}] {s.name}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectScheduleForEdit(currentSchedId);
                              setActiveTab('schedules');
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded-lg text-xs font-bold transition-colors border border-slate-700 cursor-pointer"
                          >
                            Edit Schedule
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

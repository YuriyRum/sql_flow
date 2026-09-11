import React, { useState } from 'react';
import { FlowPipeline } from '../types';
import { Plus, Layers, Database, X, Sparkles, Check } from 'lucide-react';

interface NewPipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreatePipeline: (newPipeline: FlowPipeline) => void;
}

export const NewPipelineModal: React.FC<NewPipelineModalProps> = ({
  isOpen,
  onClose,
  onCreatePipeline,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Custom Transformation');
  const [templateType, setTemplateType] = useState<'blank' | 'sales' | 'finance'>('blank');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const pipelineId = `pipe-${Date.now()}`;
    const initialNode = {
      id: `node-1`,
      name: '01. Initial Selection Stage',
      description: 'First query step in the SAP HANA sequence',
      queryType: 'SELECT' as const,
      sqlContent: `SELECT 
    "ID",
    "CODE",
    "AMOUNT",
    CURRENT_UTCTIMESTAMP AS "EXTRACTED_AT"
FROM "STAGE"."STG_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}"
WHERE "STATUS" = 'ACTIVE'
ORDER BY "EXTRACTED_AT" DESC;`,
      inputTables: [`"STAGE"."STG_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}"`],
      parameters: [],
      executionOrder: 1,
      status: 'idle' as const,
      enabled: true,
      position: { x: 80, y: 160 },
      nextNodeIds: [],
      validationSummary: { isValid: true, errors: 0, warnings: 0 },
    };

    const newPipe: FlowPipeline = {
      id: pipelineId,
      name: name.trim(),
      description: description.trim() || 'Custom SAP HANA SQL sequence pipeline',
      category,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: 'SAP HANA Developer',
      targetHanaVersion: 'SAP HANA Cloud',
      nodes: [initialNode],
      edges: [],
    };

    onCreatePipeline(newPipe);
    setName('');
    setDescription('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-scaleUp">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#fdf0f6] text-[#e20074] rounded-lg border border-[#f8b4d9]">
              <Plus className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-base text-slate-900">Create New SQL Flow Pipeline</h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Flow Process Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. S/4HANA Inventory Rebalancing Flow"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#e20074] focus:bg-white transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Process Description
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the sequence of SQL transformations..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-[#e20074] focus:bg-white resize-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Process Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-[#e20074] focus:bg-white transition-colors"
            >
              <option value="Sales & Revenue">Sales & Revenue</option>
              <option value="Finance & Controlling">Finance & Controlling</option>
              <option value="Supply Chain & Logistics">Supply Chain & Logistics</option>
              <option value="Customer 360 & Analytics">Customer 360 & Analytics</option>
              <option value="Master Data Cleanse">Master Data Cleanse</option>
              <option value="Custom Transformation">Custom Transformation</option>
            </select>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium transition-colors border border-slate-200 shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 bg-[#e20074] hover:bg-[#c70066] disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
            >
              Create Flow
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

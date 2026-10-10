import React, { useState } from 'react';
import { AShareInstrument, AssetCategory } from '../types/ashare';
import { X, PlusCircle } from 'lucide-react';

interface AddInstrumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (instrument: AShareInstrument) => void;
}

export const AddInstrumentModal: React.FC<AddInstrumentModalProps> = ({
  isOpen,
  onClose,
  onAdd,
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AssetCategory>('broad_etf');
  const [currentPrice, setCurrentPrice] = useState('3.50');
  const [annualizedVol, setAnnualizedVol] = useState('0.20');
  const [riskBudgetWeight, setRiskBudgetWeight] = useState('0.10');
  const [currentShares, setCurrentShares] = useState('0');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;

    const formattedCode = code.toUpperCase().includes('.') 
      ? code.toUpperCase() 
      : (code.startsWith('6') || code.startsWith('5') ? `${code.toUpperCase()}.SH` : `${code.toUpperCase()}.SZ`);
    
    const isETF = category !== 'stock_cn';
    const isT0 = category === 'bond_etf' || category === 'commodity_etf' || category === 'qdii_etf';
    const priceNum = Math.max(0.01, parseFloat(currentPrice) || 1.0);
    const volNum = Math.max(0.01, parseFloat(annualizedVol) || 0.18);
    const dailyATR = Number((priceNum * (volNum / Math.sqrt(250)) * 1.2).toFixed(3));

    const newInst: AShareInstrument = {
      id: code.replace(/[^a-zA-Z0-9]/g, ''),
      code: formattedCode,
      name: name.trim(),
      category,
      isETF,
      isT0,
      stampDutyExempt: isETF,
      currentPrice: priceNum,
      preClose: priceNum,
      changePct: 0.0,
      dailyATR,
      annualizedVol: volNum,
      riskBudgetWeight: parseFloat(riskBudgetWeight) || 0.10,
      currentShares: parseInt(currentShares, 10) || 0,
      bars: [],
    };

    onAdd(newInst);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0F172A] border border-slate-800 rounded-lg max-w-md w-full p-6 text-slate-200 shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">添加 A 股 / ETF 标的</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">标的代码</label>
              <input
                type="text"
                required
                placeholder="例如 512480 或 000001"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">标的名称</label>
              <input
                type="text"
                required
                placeholder="例如 半导体ETF"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-medium">标的类别与属性</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as AssetCategory)}
              className="bg-slate-900 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="broad_etf">宽基指数ETF (免印花税 · T+1)</option>
              <option value="sector_etf">行业/主题ETF (免印花税 · T+1)</option>
              <option value="bond_etf">债券/固收ETF (免印花税 · T+0)</option>
              <option value="commodity_etf">商品/黄金ETF (免印花税 · T+0)</option>
              <option value="qdii_etf">跨境QDII ETF (免印花税 · T+0)</option>
              <option value="stock_cn">A股个股 (征收印花税 · T+1)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">最新现价 (元)</label>
              <input
                type="number"
                step="0.001"
                required
                value={currentPrice}
                onChange={(e) => setCurrentPrice(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">年化波动率 (例如 0.22 = 22%)</label>
              <input
                type="number"
                step="0.01"
                required
                value={annualizedVol}
                onChange={(e) => setAnnualizedVol(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">初始风险权重 (0 - 0.3)</label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="0.4"
                value={riskBudgetWeight}
                onChange={(e) => setRiskBudgetWeight(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">当前已持股数 (100的整倍数)</label>
              <input
                type="number"
                step="100"
                min="0"
                value={currentShares}
                onChange={(e) => setCurrentShares(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-400 hover:text-white bg-slate-800 rounded transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded transition-colors"
            >
              确认加入标的池
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useState, useMemo, useEffect } from 'react';
import {
  AShareInstrument,
  CustomPortfolio,
  CustomPortfolioItem,
  CarverSettings,
} from '../types/ashare';
import { AShareDataService } from '../services/apiClient';
import {
  loadAllPortfolios,
  saveAllPortfolios,
  calculateRiskParityAllocation,
  calculateCarverDynamicAllocation,
  PORTFOLIO_SELECTED_SLOTS_KEY,
} from '../services/customPortfolioStore';
import {
  Scale,
  Sparkles,
  Plus,
  Trash2,
  Copy,
  RotateCcw,
  AlertTriangle,
  ChevronRight,
  TrendingDown,
  ShieldAlert,
  Zap,
  Info,
  ArrowRightLeft,
  FolderPlus,
  Edit2,
  Check,
  X,
  Wand2,
  Layers,
  Lock,
  Target,
} from 'lucide-react';

interface Props {
  universe: AShareInstrument[];
  settings: CarverSettings;
}

export const CustomPortfolioDiagnosticPanel: React.FC<Props> = ({ universe, settings }) => {
  // 全部自选与官方组合库
  const [portfolios, setPortfolios] = useState<CustomPortfolio[]>(() => loadAllPortfolios());

  // 双槽位当前选中的组合 ID (Slot A & Slot B)
  const [slotAId, setSlotAId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(PORTFOLIO_SELECTED_SLOTS_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p?.a) return p.a;
      }
    } catch {
      /* ignore */
    }
    return 'user_actual_holdings';
  });

  const [slotBId, setSlotBId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(PORTFOLIO_SELECTED_SLOTS_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p?.b) return p.b;
      }
    } catch {
      /* ignore */
    }
    return 'user_optimized_carver';
  });

  // 持久化当前槽位选择
  useEffect(() => {
    try {
      localStorage.setItem(PORTFOLIO_SELECTED_SLOTS_KEY, JSON.stringify({ a: slotAId, b: slotBId }));
    } catch {
      /* ignore */
    }
  }, [slotAId, slotBId]);

  // 持久化整个组合库
  useEffect(() => {
    saveAllPortfolios(portfolios);
  }, [portfolios]);

  // 获取当前 Slot A 与 Slot B 对应的实体对象
  const portfolioA = useMemo(() => {
    return portfolios.find((p) => p.id === slotAId) || portfolios[0];
  }, [portfolios, slotAId]);

  const portfolioB = useMemo(() => {
    return portfolios.find((p) => p.id === slotBId) || portfolios[1] || portfolios[0];
  }, [portfolios, slotBId]);

  // 新建组合弹窗状态
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [newPortfolioDesc, setNewPortfolioDesc] = useState('');
  const [newPortfolioCapital, setNewPortfolioCapital] = useState(420000);

  // 重命名编辑态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // 标的录入快速表单状态
  const [activeInputSlot, setActiveInputSlot] = useState<'A' | 'B'>('A');
  const [inputCode, setInputCode] = useState('');
  const [inputAmount, setInputAmount] = useState('');
  const [inputProfitRate, setInputProfitRate] = useState('');
  const [inputNotes, setInputNotes] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [resolveHint, setResolveHint] = useState<string | null>(null);

  // 快速标的候选列表（全市场热门 + 本地标的池）
  const quickSelectSymbols = useMemo(() => {
    const map = new Map<string, { code: string; name: string; category: string; vol: number }>();
    universe.forEach((u) => {
      map.set(u.code.split('.')[0], {
        code: u.code,
        name: u.name,
        category: u.category,
        vol: u.annualizedVol,
      });
    });
    if (!map.has('562500')) map.set('562500', { code: '562500.SH', name: '机器人ETF', category: 'sector_etf', vol: 0.35 });
    if (!map.has('512660')) map.set('512660', { code: '512660.SH', name: '军工/航天ETF', category: 'sector_etf', vol: 0.35 });
    if (!map.has('CASH')) map.set('CASH', { code: 'CASH', name: '现金/货币基金', category: 'bond_etf', vol: 0.01 });
    return Array.from(map.values());
  }, [universe]);

  // 测算组合的核心指标（权重、风险贡献、加权波动、压力测试回撤）
  const computePortfolioMetrics = (p: CustomPortfolio) => {
    const totalAmount = p.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const capital = p.totalCapital > 0 ? p.totalCapital : Math.max(1, totalAmount);

    const itemsWithStats = p.items.map((it) => {
      const weight = capital > 0 ? (it.amount / capital) * 100 : 0;
      const vol = it.annualizedVol ?? 0.25;
      const riskUnit = (it.amount / capital) * vol;
      return { ...it, weight, riskUnit, vol };
    });

    const totalRiskUnit = itemsWithStats.reduce((s, it) => s + it.riskUnit, 0);

    const itemsWithRiskContrib = itemsWithStats.map((it) => ({
      ...it,
      riskContributionPct: totalRiskUnit > 0 ? (it.riskUnit / totalRiskUnit) * 100 : 0,
    }));

    const highVolRiskPct = itemsWithRiskContrib
      .filter((it) => it.vol >= 0.26)
      .reduce((s, it) => s + it.riskContributionPct, 0);

    const weightedVol = itemsWithStats.reduce((s, it) => s + (it.weight / 100) * it.vol, 0);

    // 极端回撤推演 (大盘-25%, 科技-40%, 固收+4%, 黄金+6%)
    let simulatedDrawdown = 0;
    itemsWithStats.forEach((it) => {
      let shock = -0.25;
      if (it.category === 'sector_etf' || it.category === 'qdii_etf') shock = -0.38;
      else if (it.category === 'bond_etf') shock = it.code === 'CASH' ? 0.01 : 0.04;
      else if (it.category === 'commodity_etf') shock = 0.05;
      else if (it.category === 'broad_etf') shock = -0.18;
      else if (it.category === 'stock_cn') shock = -0.22;
      simulatedDrawdown += (it.amount / capital) * shock;
    });

    const totalProfit = p.items.reduce((s, it) => s + (it.profitAmount || 0), 0);
    const cashRemaining = Math.max(0, capital - totalAmount);

    return {
      totalAmount,
      capital,
      cashRemaining,
      items: itemsWithRiskContrib,
      weightedVol,
      highVolRiskPct,
      simulatedDrawdown: simulatedDrawdown * 100,
      totalProfit,
    };
  };

  const statsA = useMemo(() => computePortfolioMetrics(portfolioA), [portfolioA]);
  const statsB = useMemo(() => computePortfolioMetrics(portfolioB), [portfolioB]);

  // 新建自选组合
  const handleCreateNewPortfolio = () => {
    if (!newPortfolioName.trim()) return;
    const newId = `user_portfolio_${Date.now()}`;
    const newP: CustomPortfolio = {
      id: newId,
      name: newPortfolioName.trim(),
      description: newPortfolioDesc.trim() || '用户自定义持仓组合',
      totalCapital: newPortfolioCapital || 420000,
      isOfficial: false,
      updatedAt: new Date().toISOString(),
      items: [],
    };
    setPortfolios((prev) => [...prev, newP]);
    setSlotBId(newId);
    setIsCreatingNew(false);
    setNewPortfolioName('');
    setNewPortfolioDesc('');
  };

  // 重命名组合
  const handleRenamePortfolio = (id: string) => {
    if (!editingName.trim()) {
      setEditingId(null);
      return;
    }
    setPortfolios((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: editingName.trim(), updatedAt: new Date().toISOString() } : p))
    );
    setEditingId(null);
    setEditingName('');
  };

  // 删除自选组合 (官方内置不可删除)
  const handleDeletePortfolio = (id: string) => {
    const target = portfolios.find((p) => p.id === id);
    if (target?.isOfficial) {
      alert('官方内置基准组合已锁定，不能删除。');
      return;
    }
    if (confirm(`确定要彻底删除自选组合 [${target?.name}] 吗？`)) {
      setPortfolios((prev) => prev.filter((p) => p.id !== id));
      if (slotAId === id) setSlotAId(portfolios[0]?.id || 'official_balanced9');
      if (slotBId === id) setSlotBId(portfolios[1]?.id || portfolios[0]?.id || 'official_balanced9');
    }
  };

  // 复制当前组合为自选新副本
  const handleClonePortfolio = (sourceId: string) => {
    const src = portfolios.find((p) => p.id === sourceId);
    if (!src) return;
    const newId = `user_portfolio_copy_${Date.now()}`;
    const copyP: CustomPortfolio = {
      ...src,
      id: newId,
      name: `${src.name} (自选副本)`,
      isOfficial: false,
      updatedAt: new Date().toISOString(),
      items: src.items.map((it) => ({ ...it, id: `it_${Date.now()}_${Math.random().toString(36).slice(2, 5)}` })),
    };
    setPortfolios((prev) => [...prev, copyP]);
    setSlotBId(newId);
  };

  // 🎯 真正的 Carver 系统化动态定仓 (动量标量 + 估值守门 + 单标的封顶 + 现金备付)
  const handleCarverDynamicStrategy = (targetId: string) => {
    const target = portfolios.find((p) => p.id === targetId);
    if (!target || !target.items.length) {
      alert('该组合中暂无标的，请先添加标的。');
      return;
    }
    const res = calculateCarverDynamicAllocation(target, universe, settings);
    setPortfolios((prev) =>
      prev.map((p) => (p.id === targetId ? { ...p, items: res.items, updatedAt: new Date().toISOString() } : p))
    );
    alert(res.message);
  };

  // ⚖️ 纯静态波动率反比平准化 (满仓配平，100% 填满资金)
  const handleStaticRiskParityAllocation = (targetId: string) => {
    const target = portfolios.find((p) => p.id === targetId);
    if (!target || !target.items.length) {
      alert('该组合中暂无标的，请先添加标的。');
      return;
    }
    const allocationMap = calculateRiskParityAllocation(target.items, target.totalCapital);
    const updatedItems = target.items.map((it) => ({
      ...it,
      amount: allocationMap.get(it.code) ?? it.amount,
      notes: (it.notes ? it.notes + '；' : '') + '静态波动率反比满仓配平',
    }));

    setPortfolios((prev) =>
      prev.map((p) => (p.id === targetId ? { ...p, items: updatedItems, updatedAt: new Date().toISOString() } : p))
    );
  };

  // 快捷添加标的
  const handleAddItem = async (targetId: string) => {
    if (!inputCode.trim()) return;
    const clean = inputCode.trim().toUpperCase();
    const amt = parseFloat(inputAmount) || 10000;
    const pRate = inputProfitRate.trim() ? parseFloat(inputProfitRate) : undefined;

    setIsResolving(true);
    setResolveHint('正在智能解析代码并同步最新行情...');

    let resolvedName = clean;
    let resolvedCategory: any = 'sector_etf';
    let resolvedVol = 0.25;
    let resolvedPrice = 1.0;

    if (clean === 'CASH') {
      resolvedName = '现金 / 货币基金';
      resolvedCategory = 'bond_etf';
      resolvedVol = 0.01;
      resolvedPrice = 1.0;
    } else {
      const res = await AShareDataService.resolveSymbol(clean);
      if (res.success && res.instrument) {
        resolvedName = res.instrument.name;
        resolvedCategory = res.instrument.category;
        resolvedVol = res.instrument.annualizedVol;
        resolvedPrice = res.instrument.currentPrice;
      }
    }

    const newItem: CustomPortfolioItem = {
      id: `it_${Date.now()}`,
      code: clean,
      name: resolvedName,
      category: resolvedCategory,
      amount: amt,
      currentPrice: resolvedPrice,
      profitRate: pRate,
      profitAmount: pRate !== undefined ? amt - amt / (1 + pRate / 100) : undefined,
      annualizedVol: resolvedVol,
      notes: inputNotes || undefined,
    };

    setPortfolios((prev) =>
      prev.map((p) => (p.id === targetId ? { ...p, items: [...p.items, newItem], updatedAt: new Date().toISOString() } : p))
    );

    setInputCode('');
    setInputAmount('');
    setInputProfitRate('');
    setInputNotes('');
    setIsResolving(false);
    setResolveHint(null);
  };

  // 从指定组合中删除单个标的
  const handleRemoveItem = (portfolioId: string, itemId: string) => {
    const target = portfolios.find((p) => p.id === portfolioId);
    if (target?.isOfficial) {
      if (confirm('当前选中的是官方基准。建议复制为自选副本后再修改，是否立即克隆为自选组合？')) {
        handleClonePortfolio(portfolioId);
      }
      return;
    }

    setPortfolios((prev) =>
      prev.map((p) =>
        p.id === portfolioId
          ? { ...p, items: p.items.filter((it) => it.id !== itemId), updatedAt: new Date().toISOString() }
          : p
      )
    );
  };

  // 计算从 A 切换到 B 的再平衡调仓动作清单
  const rebalanceActions = useMemo(() => {
    const mapA = new Map<string, number>();
    const mapB = new Map<string, number>();
    const names = new Map<string, string>();

    portfolioA.items.forEach((i) => {
      mapA.set(i.code, (mapA.get(i.code) || 0) + i.amount);
      names.set(i.code, i.name);
    });

    portfolioB.items.forEach((i) => {
      mapB.set(i.code, (mapB.get(i.code) || 0) + i.amount);
      names.set(i.code, i.name);
    });

    const allCodes = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));
    return allCodes
      .map((c) => {
        const amtA = mapA.get(c) || 0;
        const amtB = mapB.get(c) || 0;
        const delta = amtB - amtA;
        return {
          code: c,
          name: names.get(c) || c,
          currentAmt: amtA,
          targetAmt: amtB,
          delta,
          action: delta > 100 ? 'BUY' : delta < -100 ? 'SELL' : 'HOLD',
        };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [portfolioA, portfolioB]);

  return (
    <div className="flex flex-col gap-6 p-6 bg-[#0B0F19] text-slate-100 min-h-screen">
      {/* 头部标题与自选组管理栏 */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-bold tracking-tight text-white">实盘持仓诊断与自选组合 A/B 对比</h1>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-mono">
              全天候多组 PK
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            支持自由新建与管理多套自选组合，下拉菜单任选两套同台 PK 诊断。一键测算波动率平准化配置，生成平稳变轨路径。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCreatingNew(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            <FolderPlus className="w-4 h-4" />
            <span>新建自选组合</span>
          </button>
          <button
            onClick={() => handleClonePortfolio(slotAId)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            title="将槽位 A 复制为自选新副本"
          >
            <Copy className="w-3.5 h-3.5 text-indigo-400" />
            <span>克隆 A 为自选副本</span>
          </button>
        </div>
      </div>

      {/* 新建自选组合弹出表单 */}
      {isCreatingNew && (
        <div className="p-4 rounded-xl bg-slate-900 border border-emerald-700/60 shadow-xl flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-400">
            <span>✨ 新建用户自选组合</span>
            <button onClick={() => setIsCreatingNew(false)} className="text-slate-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">组合名称</label>
              <input
                type="text"
                placeholder="例如 我的养老稳健仓 / 激进进攻仓"
                value={newPortfolioName}
                onChange={(e) => setNewPortfolioName(e.target.value)}
                className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">总本金金额 (元)</label>
              <input
                type="number"
                placeholder="420000"
                value={newPortfolioCapital}
                onChange={(e) => setNewPortfolioCapital(Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs outline-none focus:border-emerald-500 font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">组合描述 (可选)</label>
              <input
                type="text"
                placeholder="例如 控高波科技比例，加国债对冲"
                value={newPortfolioDesc}
                onChange={(e) => setNewPortfolioDesc(e.target.value)}
                className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setIsCreatingNew(false)}
              className="px-3 py-1 rounded text-xs bg-slate-800 text-slate-400 hover:text-white"
            >
              取消
            </button>
            <button
              onClick={handleCreateNewPortfolio}
              disabled={!newPortfolioName.trim()}
              className="px-4 py-1 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              确认创建
            </button>
          </div>
        </div>
      )}

      {/* 槽位选择与切换器 (Slot A Selector vs Slot B Selector) */}
      <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 槽位 A 选择 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <label className="text-xs font-bold text-white">槽位 A (对比基准/现状组合)</label>
            </div>
            {portfolioA.isOfficial ? (
              <span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                <Lock className="w-3 h-3" /> 官方内置锁定
              </span>
            ) : (
              <div className="flex items-center gap-2 text-xs">
                {editingId === portfolioA.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="px-1.5 py-0.5 rounded bg-slate-950 border border-emerald-500 text-xs text-white"
                    />
                    <button onClick={() => handleRenamePortfolio(portfolioA.id)} className="text-emerald-400">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-slate-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(portfolioA.id);
                      setEditingName(portfolioA.name);
                    }}
                    className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px]"
                  >
                    <Edit2 className="w-3 h-3" /> 重命名
                  </button>
                )}
                <button
                  onClick={() => handleDeletePortfolio(portfolioA.id)}
                  className="text-slate-500 hover:text-red-400 text-[11px] flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> 删除
                </button>
              </div>
            )}
          </div>

          <select
            value={slotAId}
            onChange={(e) => setSlotAId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-medium focus:border-rose-500 outline-none"
          >
            <optgroup label="📂 官方基准方案">
              {portfolios
                .filter((p) => p.isOfficial)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (标的: {p.items.length}只 · ¥{(p.totalCapital / 10000).toFixed(0)}w)
                  </option>
                ))}
            </optgroup>
            <optgroup label="👤 我的自选与实盘组">
              {portfolios
                .filter((p) => !p.isOfficial)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (标的: {p.items.length}只 · ¥{(p.totalCapital / 10000).toFixed(0)}w)
                  </option>
                ))}
            </optgroup>
          </select>
        </div>

        {/* 槽位 B 选择 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <label className="text-xs font-bold text-white">槽位 B (目标方案/拟定优化)</label>
            </div>
            {portfolioB.isOfficial ? (
              <span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                <Lock className="w-3 h-3" /> 官方内置锁定
              </span>
            ) : (
              <div className="flex items-center gap-2 text-xs">
                {editingId === portfolioB.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="px-1.5 py-0.5 rounded bg-slate-950 border border-emerald-500 text-xs text-white"
                    />
                    <button onClick={() => handleRenamePortfolio(portfolioB.id)} className="text-emerald-400">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-slate-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(portfolioB.id);
                      setEditingName(portfolioB.name);
                    }}
                    className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px]"
                  >
                    <Edit2 className="w-3 h-3" /> 重命名
                  </button>
                )}
                <button
                  onClick={() => handleDeletePortfolio(portfolioB.id)}
                  className="text-slate-500 hover:text-red-400 text-[11px] flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> 删除
                </button>
              </div>
            )}
          </div>

          <select
            value={slotBId}
            onChange={(e) => setSlotBId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-medium focus:border-emerald-500 outline-none"
          >
            <optgroup label="📂 官方基准方案">
              {portfolios
                .filter((p) => p.isOfficial)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (标的: {p.items.length}只 · ¥{(p.totalCapital / 10000).toFixed(0)}w)
                  </option>
                ))}
            </optgroup>
            <optgroup label="👤 我的自选与实盘组">
              {portfolios
                .filter((p) => !p.isOfficial)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (标的: {p.items.length}只 · ¥{(p.totalCapital / 10000).toFixed(0)}w)
                  </option>
                ))}
            </optgroup>
          </select>
        </div>
      </div>

      {/* 核心五维 A/B 对比仪表盘 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* 维度 1: 高波动资产风险贡献 */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-white">高波资产风险占比 (Risk Contribution)</span>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <div className="mt-3 flex items-baseline justify-between font-mono">
              <div>
                <div className="text-[10px] text-slate-500">槽位 A</div>
                <div className={`text-xl font-bold ${statsA.highVolRiskPct > 65 ? 'text-rose-400' : 'text-slate-200'}`}>
                  {statsA.highVolRiskPct.toFixed(1)}%
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600" />
              <div>
                <div className="text-[10px] text-slate-500">槽位 B</div>
                <div className="text-xl font-bold text-emerald-400">
                  {statsB.highVolRiskPct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
            {statsA.highVolRiskPct > 65 ? (
              <span className="text-amber-300">⚠️ A风险集中：科技成长贡献了超 70% 波动！</span>
            ) : (
              <span className="text-emerald-300">✓ 风险平价平准化</span>
            )}
          </div>
        </div>

        {/* 维度 2: 加权年化波动率 */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-white">组合加权年化波动率</span>
              <Zap className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="mt-3 flex items-baseline justify-between font-mono">
              <div>
                <div className="text-[10px] text-slate-500">槽位 A</div>
                <div className="text-xl font-bold text-slate-200">
                  {(statsA.weightedVol * 100).toFixed(1)}%
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600" />
              <div>
                <div className="text-[10px] text-slate-500">槽位 B</div>
                <div className="text-xl font-bold text-cyan-400">
                  {(statsB.weightedVol * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
            <span>波动率压降: </span>
            <span className="font-mono text-emerald-400 font-bold">
              {((statsA.weightedVol - statsB.weightedVol) * 100).toFixed(1)}%
            </span>
            <span className="text-slate-500 text-[10px]"> (大幅缓解持仓焦虑)</span>
          </div>
        </div>

        {/* 维度 3: 极端情景预测回撤 */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-white">2018/2022级别极端行情预测回撤</span>
              <TrendingDown className="w-4 h-4 text-rose-400" />
            </div>
            <div className="mt-3 flex items-baseline justify-between font-mono">
              <div>
                <div className="text-[10px] text-slate-500">槽位 A 回撤</div>
                <div className="text-xl font-bold text-rose-400">
                  {statsA.simulatedDrawdown.toFixed(1)}%
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600" />
              <div>
                <div className="text-[10px] text-slate-500">槽位 B 回撤</div>
                <div className="text-xl font-bold text-emerald-400">
                  {statsB.simulatedDrawdown.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
            <span>抗跌韧性提升: </span>
            <span className="font-mono text-emerald-400 font-bold">
              +{(Math.abs(statsA.simulatedDrawdown) - Math.abs(statsB.simulatedDrawdown)).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* 维度 4: 现金与缓冲备付金 */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-white">固收与现金备付安全垫</span>
              <ShieldAlert className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="mt-3 flex items-baseline justify-between font-mono">
              <div>
                <div className="text-[10px] text-slate-500">槽位 A</div>
                <div className="text-xl font-bold text-amber-400">
                  ¥{Math.round(statsA.cashRemaining).toLocaleString('zh-CN')}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600" />
              <div>
                <div className="text-[10px] text-slate-500">槽位 B</div>
                <div className="text-xl font-bold text-indigo-300">
                  ¥{Math.round(statsB.cashRemaining).toLocaleString('zh-CN')}
                </div>
              </div>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
            <span className="text-indigo-300">备付安全垫为心理底牌</span>
          </div>
        </div>
      </div>

      {/* 快捷输入与标的录入栏 */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-white">添加或修改标的</span>
            <span className="text-[11px] text-slate-400">
              （当前目标：
              <strong className={activeInputSlot === 'A' ? 'text-rose-400' : 'text-emerald-400'}>
                {activeInputSlot === 'A' ? portfolioA.name : portfolioB.name}
              </strong>
              ）
            </span>
          </div>

          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveInputSlot('A')}
              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                activeInputSlot === 'A' ? 'bg-rose-900/80 text-rose-200 border border-rose-700' : 'text-slate-400 hover:text-white'
              }`}
            >
              录入到槽位 A
            </button>
            <button
              onClick={() => setActiveInputSlot('B')}
              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                activeInputSlot === 'B' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              录入到槽位 B
            </button>
          </div>
        </div>

        {/* 标的池快捷点击按钮 */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400 text-[11px] mr-1">标的池快捷选择:</span>
          {quickSelectSymbols.map((qs) => (
            <button
              key={qs.code}
              type="button"
              onClick={() => {
                setInputCode(qs.code);
              }}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 hover:border-emerald-500 font-mono text-[11px] transition-colors"
            >
              {qs.name} <span className="text-[10px] text-slate-500">({qs.code.split('.')[0]})</span>
            </button>
          ))}
        </div>

        {/* 录入表单栏 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end pt-1">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">代码 / 拼音 (自动补全)</label>
            <input
              type="text"
              placeholder="例如 513180 或 562500"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">持仓金额 (元)</label>
            <input
              type="number"
              placeholder="例如 150000"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">浮动盈亏率 (%, 可选)</label>
            <input
              type="number"
              placeholder="例如 -24.0 或 +3.0"
              value={inputProfitRate}
              onChange={(e) => setInputProfitRate(e.target.value)}
              className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">持仓备注 (可选)</label>
            <input
              type="text"
              placeholder="例如 逢高减仓 / 核心底仓"
              value={inputNotes}
              onChange={(e) => setInputNotes(e.target.value)}
              className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-white text-xs focus:border-emerald-500 outline-none"
            />
          </div>

          <button
            type="button"
            disabled={isResolving || !inputCode.trim()}
            onClick={() => handleAddItem(activeInputSlot === 'A' ? slotAId : slotBId)}
            className="flex items-center justify-center gap-1.5 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isResolving ? '解析中...' : `添加至槽位 ${activeInputSlot}`}</span>
          </button>
        </div>

        {resolveHint && (
          <div className="text-[11px] text-emerald-400 animate-pulse flex items-center gap-1 font-mono">
            <Info className="w-3.5 h-3.5" />
            <span>{resolveHint}</span>
          </div>
        )}
      </div>

      {/* 双持仓明细镜像对比 (左 Slot A，右 Slot B) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 组合 A 卡片 */}
        <div className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-sm">{portfolioA.name}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/80 font-mono">
                  槽位 A
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">{portfolioA.description}</div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleCarverDynamicStrategy(portfolioA.id)}
                className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
                title="🎯 真正的 Carver 系统化策略定仓：综合动量标量、年线均线、估值守门与硬风控上限，合理定仓并保留现金备付"
              >
                <Target className="w-3.5 h-3.5" />
                <span>Carver策略定仓</span>
              </button>
              <button
                onClick={() => handleStaticRiskParityAllocation(portfolioA.id)}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
                title="⚖️ 纯静态波动率反比满仓配平（强行填满 100% 资金，不留现金）"
              >
                <Wand2 className="w-3 h-3 text-slate-400" />
                <span>静态满仓配平</span>
              </button>
              <div className="text-right font-mono pl-2 border-l border-slate-800">
                <div className="text-xs text-slate-400">总持仓市值</div>
                <div className="text-emerald-400 font-bold text-base">
                  ¥{statsA.totalAmount.toLocaleString('zh-CN')}
                </div>
              </div>
            </div>
          </div>

          {/* 明细列表 */}
          <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
            {statsA.items.map((it) => (
              <div
                key={it.id}
                className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3 text-xs hover:border-slate-700 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-white">{it.name}</span>
                    <span className="text-[10px] font-mono text-slate-500">{it.code}</span>
                    {it.vol >= 0.28 && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-rose-950 text-rose-300">高波</span>
                    )}
                  </div>
                  {it.notes && <div className="text-[10px] text-slate-400 mt-0.5">{it.notes}</div>}
                </div>

                <div className="text-right font-mono shrink-0">
                  <div className="text-slate-200 font-medium">¥{it.amount.toLocaleString('zh-CN')}</div>
                  <div className="text-[10px] text-slate-400">占比 {it.weight.toFixed(1)}%</div>
                </div>

                <div className="text-right font-mono shrink-0 w-20">
                  <div className="text-[10px] text-slate-400">风险贡献</div>
                  <div className={`font-bold ${it.riskContributionPct > 25 ? 'text-rose-400' : 'text-slate-300'}`}>
                    {it.riskContributionPct.toFixed(1)}%
                  </div>
                </div>

                {it.profitRate !== undefined && (
                  <div className="text-right font-mono shrink-0 w-16">
                    <div className={`font-bold ${it.profitRate >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {it.profitRate >= 0 ? `+${it.profitRate}%` : `${it.profitRate}%`}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleRemoveItem(portfolioA.id, it.id)}
                  className="text-slate-500 hover:text-red-400 p-1"
                  title="删除标的"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 组合 B 卡片 */}
        <div className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-sm">{portfolioB.name}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-mono">
                  槽位 B
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">{portfolioB.description}</div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleCarverDynamicStrategy(portfolioB.id)}
                className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
                title="🎯 真正的 Carver 系统化策略定仓：综合动量标量、年线均线、估值守门与硬风控上限，合理定仓并保留现金备付"
              >
                <Target className="w-3.5 h-3.5" />
                <span>Carver策略定仓</span>
              </button>
              <button
                onClick={() => handleStaticRiskParityAllocation(portfolioB.id)}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 transition-colors"
                title="⚖️ 纯静态波动率反比满仓配平（强行填满 100% 资金，不留现金）"
              >
                <Wand2 className="w-3 h-3 text-slate-400" />
                <span>静态满仓配平</span>
              </button>
              <div className="text-right font-mono pl-2 border-l border-slate-800">
                <div className="text-xs text-slate-400">总持仓市值</div>
                <div className="text-emerald-400 font-bold text-base">
                  ¥{statsB.totalAmount.toLocaleString('zh-CN')}
                </div>
              </div>
            </div>
          </div>

          {/* 明细列表 */}
          <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
            {statsB.items.map((it) => (
              <div
                key={it.id}
                className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3 text-xs hover:border-slate-700 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-white">{it.name}</span>
                    <span className="text-[10px] font-mono text-slate-500">{it.code}</span>
                    {it.category === 'bond_etf' && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-950 text-indigo-300">压舱石</span>
                    )}
                  </div>
                  {it.notes && <div className="text-[10px] text-slate-400 mt-0.5">{it.notes}</div>}
                </div>

                <div className="text-right font-mono shrink-0">
                  <div className="text-slate-200 font-medium">¥{it.amount.toLocaleString('zh-CN')}</div>
                  <div className="text-[10px] text-slate-400">占比 {it.weight.toFixed(1)}%</div>
                </div>

                <div className="text-right font-mono shrink-0 w-20">
                  <div className="text-[10px] text-slate-400">风险贡献</div>
                  <div className="font-bold text-emerald-400">
                    {it.riskContributionPct.toFixed(1)}%
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveItem(portfolioB.id, it.id)}
                  className="text-slate-500 hover:text-red-400 p-1"
                  title="删除标的"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* A -> B 迁移再平衡动作清单 (Rebalance Delta Plan) */}
      <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col gap-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm font-bold text-white">从 [槽位 A] 变轨至 [槽位 B] 的调仓动作清单 (Rebalance Actions)</h2>
          </div>
          <span className="text-xs text-slate-400">
            建议通过 2~3 周分批执行，避免单日左侧割肉或冲击滑点
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rebalanceActions.map((act) => {
            if (act.action === 'HOLD') return null;
            const isSell = act.action === 'SELL';
            return (
              <div
                key={act.code}
                className={`p-3 rounded-lg border flex flex-col justify-between gap-2 ${
                  isSell
                    ? 'bg-rose-950/20 border-rose-900/50 text-rose-200'
                    : 'bg-emerald-950/20 border-emerald-900/50 text-emerald-200'
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">{act.name}</span>
                  <span
                    className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
                      isSell ? 'bg-rose-900 text-rose-200' : 'bg-emerald-900 text-emerald-200'
                    }`}
                  >
                    {isSell ? '建议减仓/卖出' : '建议买入/建仓'}
                  </span>
                </div>

                <div className="flex items-baseline justify-between font-mono text-xs">
                  <div className="text-slate-400 text-[11px]">
                    ¥{act.currentAmt.toLocaleString()} ➜ ¥{act.targetAmt.toLocaleString()}
                  </div>
                  <div className={`font-bold text-sm ${isSell ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {isSell ? `-¥${Math.abs(act.delta).toLocaleString()}` : `+¥${act.delta.toLocaleString()}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

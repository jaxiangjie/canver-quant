/**
 * A-Share & ETF Systematic Trading Types (Robert Carver Framework)
 */

export type AssetCategory = 
  | 'broad_etf'       // 宽基指数ETF (如 510300 沪深300, 510500 中证500, 588000 科创50, 159915 创业板)
  | 'sector_etf'      // 行业/主题ETF (如 512890 红利低波, 512480 半导体)
  | 'bond_etf'        // 债券/固收ETF (如 511010 国债ETF, 511090 30年国债ETF)
  | 'commodity_etf'   // 大宗/黄金ETF (如 518880 黄金ETF)
  | 'qdii_etf'        // 跨境QDII ETF (如 513100 纳指ETF, 513050 中概互联)
  | 'stock_cn';       // A股个股 (如 600519 贵州茅台, 300750 宁德时代)

export interface AShareBar {
  tradeDate: string;    // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  preClose?: number;
  volume: number;       // 成交量 (手)
  turnover: number;     // 成交额 (万元，展示用)
  amount?: number;      // 真实成交额 (元)，优先用于 ADV / 市场冲击成本计算
  changePct: number;    // 涨跌幅 (%)
  ma20?: number;
  ma60?: number;
  ma250?: number;
  atr20?: number;
}

export interface AShareInstrument {
  id: string;
  code: string;         // 如 "510300.SH" 或 "600519.SH"
  name: string;
  category: AssetCategory;
  isETF: boolean;
  isT0: boolean;         // 是否支持T+0 (跨境QDII、黄金、债券ETF支持)
  stampDutyExempt: boolean; // 是否免印花税 (ETF为true免税，个股为false征收千分之0.5)
  currentPrice: number;
  preClose: number;
  changePct: number;
  dailyATR: number;     // 20日ATR (绝对价格波幅)
  annualizedVol: number;// 20日年化波动率 (例如 0.18 = 18%)
  dataSource?: 'parquet' | 'fallback' | 'manual' | 'realtime_synced'; // 数据来源：parquet 真实行情 / 无数据回退模板 / 用户自定义 / 实时增量同步
  vwapPrice?: number;  // 市价近似：parquet amount/volume 的 VWAP（hfq close 含复权系数，不能直接当市价用于下单/定仓）
  syntheticBars?: boolean;  // bars 是否为合成的伪数据（无真实行情源）；回测与相关性计算应排除此类标的
  riskBudgetWeight: number; // 目标风险预算权重 (0 - 1)
  currentShares: number;// 当前实际持有股数 (手数为 currentShares / 100)
  premiumDiscountRate?: number; // ETF二级市场折溢价率 (%)
  dividendYield?: number;       // 股息率 (%)
  peTTM?: number;               // 滚动市盈率 (PE-TTM)
  pb?: number;                  // 市净率 (PB)
  pePercentile?: number;        // PE历史百分位 (0 - 100%)
  pbPercentile?: number;        // PB历史百分位 (0 - 100%)
  valuationSource?: 'direct' | 'index_mapped'; // 估值来源：direct=自身PE/PB(东财互验)；index_mapped=映射指数PE(腾讯单通道)
  // 基本面扩展字段（解耦设计：由 fundamentalService 注入）
  roe?: number;                 // 最新扣非/净资产收益率 (%)
  netProfitGrowthYoy?: number;  // 归母净利润同比增速 (%)
  revenueGrowthYoy?: number;    // 营业总收入同比增速 (%)
  grossMargin?: number;         // 销售毛利率 (%)
  debtRatio?: number;           // 资产负债率 (%)
  eps?: number;                 // 每股收益 (元)
  bps?: number;                 // 每股净资产 (元)
  latestReportPeriod?: string;  // 最新财报期 (例如 "2026中报", "2025年报")
  historicalFundamentals?: FinancialReportPoint[]; // 近多期财报历史趋势 (季频/年频)
  fundamentalQualityScore?: number; // 基本面综合质量分 (0 - 100)
  valueTrapRisk?: 'LOW' | 'MEDIUM' | 'HIGH'; // 价值陷阱风险等级
  historicalValuation?: HistoricalValuationPoint[]; // 历史估值分位序列 (含PE/PB分位及数值)
  bars: AShareBar[];    // 历史日线
}

export interface FinancialReportPoint {
  period: string;               // 报告期，如 "2026中报", "2026一季报", "2025年报"
  date: string;                 // 报告发布/截止日期 YYYY-MM-DD
  roe?: number;                 // 扣非ROE / ROE(加权) (%)
  netProfitGrowthYoy?: number;  // 归母净利润同比 (%)
  revenueGrowthYoy?: number;    // 营业收入同比 (%)
  grossMargin?: number;         // 销售毛利率 (%)
  debtRatio?: number;           // 资产负债率 (%)
}

export interface FundamentalProfile {
  code: string;
  name: string;
  dividendYield?: number;
  roe?: number;
  netProfitGrowthYoy?: number;
  revenueGrowthYoy?: number;
  grossMargin?: number;
  debtRatio?: number;
  eps?: number;
  bps?: number;
  latestReportPeriod?: string;
  reports?: FinancialReportPoint[];
  qualityScore: number;         // 质量评分 0 - 100
  valueTrapRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  diagnosticSummary: string;    // 诊断结论简述
}

export interface HistoricalValuationPoint {
  date: string;
  pe: number;
  pb: number;
  pePercentile: number;
  pbPercentile: number;
  compositePercentile: number;
}

export interface ValuationPercentileSignal {
  peTTM: number;
  pb: number;
  pePercentile: number;
  pbPercentile: number;
  compositePercentile: number;
  valuationZone: 'EXTREME_LOW' | 'UNDERVALUED' | 'FAIR' | 'OVERVALUED' | 'EXTREME_HIGH';
  zoneLabel: string;
  positionAdjustmentSuggestion: string;
  positionMultiplier: number; // 仓位调整系数，如 1.2x 溢价 或 0.8x 折价
  history5y: HistoricalValuationPoint[]; // 过去5年历史估值百分位序列
}

export interface EWMACSignal {
  fastSpan: number;
  slowSpan: number;
  rawDiff: number;
  scaledScalar: number; // -20 到 +20
}

export interface StrategySignals {
  ewmacFastSlow: {
    ewmac8_32: number;
    ewmac16_64: number;
    ewmac32_128: number;
    compositeScalar: number; // -20 到 +20 卡弗预测标量
  };
  absoluteMomentumPass: boolean; // 是否站上250日年线 (防熊市绝对动量过滤)
  relativeStrengthRank: number;  // 全市场相对强弱分位数 (0 - 100)
  dividendRankScore?: number;    // 红利安全边际分 (0 - 100)
  valuationSignal: ValuationPercentileSignal; // 滚动市盈率PE与市净率PB估值百分位
  liquidityState: 'NORMAL' | 'CAUTION_T1' | 'LIMIT_DOWN_RISK'; // 流动性评级
  finalForecastScalar: number;   // 综合卡弗标量 ( -20 到 +20 )
}

export interface CarverSettings {
  totalCapital: number;          // 初始资金，默认 1,000,000 元
  targetAnnualVol: number;       // 目标年化波动率，默认 0.12 (12%)
  bufferThreshold: number;       // 调仓死区缓冲比例，默认 0.12 (12%)
  maxInstrumentRiskCap: number;  // 单标的风险敞口上限，默认 0.25 (25%)
  maxLeverage: number;           // 最大允许杠杆率上限，默认 0.20 (20% 杠杆，即组合总市值最多 120% / 1.20x)
  maxInstrumentPositionCap: number; // 单标的最高资金占比上限，默认 0.25 (25%)
  maxBondCap?: number;           // 债券资产总额/单标的上限，默认 0.20 (20%，防止超低波债券过度占用资金拖累年化)
  hysteresisBuffer?: boolean;    // 是否启用缓冲带回差调仓 (Hysteresis Buffer)：触发后调至边界而非靶心，避免边缘来回摩擦
  minTradeAmount?: number;       // 最低调仓成交金额门槛 (元)，默认 2000 元，低于此金额暂缓调仓，节省整手碎股与手续费
  useIDM?: boolean;              // 是否启用卡弗标的分散化乘数 (Instrument Diversification Multiplier)，解决多标的低波导致的年化偏低问题
  idmMode?: 'auto' | 'manual';   // IDM 设置模式：'auto' (根据相关性矩阵自动计算) 或 'manual' (用户手动指定)
  manualIDM?: number;            // 手动指定的分散化乘数 (推荐区间 1.20 - 1.80)
  maxIDM?: number;               // IDM 放大倍数上限，默认 1.80
  useERPTilt?: boolean;          // 是否启用 A股股债收益差 (ERP/Fed模型) 逆向战术偏置
  useQualityGate?: boolean;      // 基本面质量守门人 (Piotroski/Quality Gate)：排除高危价值陷阱标的，禁止对亏损/业绩暴跌标的逆势加仓
  useTrendGate?: boolean;        // 动量趋势守门人 (Asness/Trend Gate)：右侧确认原则，要求站上年线或动量非负才激活低估加仓
  enforceTargetVol?: boolean;     // 目标波动是否作为基准敞口（中性=1.0x 满仓）而非上限；默认 true，让目标波动率真正生效
  stockCommissionRate: number;   // 股票交易佣金率，默认 0.00025 (万2.5)
  etfCommissionRate: number;     // ETF交易佣金率，默认 0.0001 (万1)
  stockStampDuty: number;        // 股票卖出印花税，默认 0.0005 (千0.5)
  slippageBps: number;           // 滑点基点，默认 5 bps
}

// ──────────────────────────────────────────────────────────────
// 标的组合（bundle）：把若干标的 + 各自风险预算权重打包成一个可切换的测试宇宙
// ──────────────────────────────────────────────────────────────
export interface BundleItem {
  id: string;               // 标的物 id（与 AShareInstrument.id 对应，通常为 6 位代码）
  riskBudgetWeight: number; // 该标的在本组合中的风险预算权重 (0 - 1)
}

export interface InstrumentBundle {
  id: string;
  name: string;
  description?: string;
  items: BundleItem[];
}

export interface PositionCalculation {
  instrument: AShareInstrument;
  currentShares: number;
  currentValue: number;
  currentWeight: number;
  
  // 卡弗波动率计算
  dailyInstrumentVol: number;   // 单股日波动率 (元)
  dailyCashRisk: number;        // 每日现金风险预算 (元)
  basePositionShares: number;   // 基准股数 (未加标量)
  
  // 预测标量与目标计算
  forecastScalar: number;       // -20 到 +20
  scalarMultiplier: number;     // 放大/防御倍数 (例如 0.5x ~ 1.8x)
  rawTargetShares: number;      // 理论浮点目标股数
  targetShares: number;         // A股向下取整到100股 (整手)
  targetCapital: number;        // 目标配置金额
  targetWeight: number;         // 目标总资金占比
  
  // 调仓与缓冲带判断
  shareDelta: number;           // 需买入(+)或卖出(-)股数
  capitalDelta: number;         // 变动资金额
  withinBuffer: boolean;        // 是否落在缓冲带内 (无需调仓)
  action: 'BUY' | 'SELL' | 'HOLD';
  recommendedShares: number;    // 经缓冲过滤后的最终建议执行股数 (必须是100整倍数)
  estimatedFee: number;         // 预估交易手续费与税费
}

export interface PortfolioSummaryStats {
  totalCapital: number;
  currentEquityValue: number;
  cashBalance: number;
  equityRatio: number;          // 当前持仓总仓位占比 (%)
  targetEquityValue: number;    // 目标总持仓市值 (元)
  targetLeverageRatio: number;  // 目标总仓位率 (%)
  targetLeveragePct: number;    // 目标净杠杆率 (%) = Math.max(0, targetLeverageRatio - 100)
  maxLeverageLimitPct: number;  // 最大杠杆上限 (%) = 20%
  isLeverageConstrained: boolean; // 是否激活杠杆硬顶约束
  rawTargetLeverageRatio: number; // 原始未约束杠杆率 (%)
  portfolioAnnualVol: number;   // 组合加权年化波动率 (%)
  dailyExpectedRisk: number;    // 组合每日期望风险 (元)
  pendingTradeCount: number;    // 待执行调仓笔数
  estimatedRebalanceCost: number; // 调仓总摩擦成本 (元)
  carverIDM: number;            // 实时卡弗标的分散化乘数 (IDM)
  effectiveAnnualVol: number;   // IDM 修正后的预期组合年化波动率 (%)
  expectedAnnualReturn: number; // 理论预期综合年化收益率 (%)
  riskAdjustedReturn: number;   // 波动率调整后绩效 (夏普比率 Sharpe Ratio = (R - Rf) / Vol)
  returnToVolRatio: number;     // 收益波动比 (Expected Return / Vol)
  sortinoRatio: number;         // 索提诺比率 (仅惩罚下行波动的风险调整收益)
  calmarRatio: number;          // 卡尔玛比率 (年化预期收益 / 预估最大回撤)
}

export interface BacktestDataPoint {
  date: string;
  carverStrategyEquity: number; // 卡弗波动率定仓净值 (带T+1流动性保护)
  carverUnprotectedEquity: number; // 未开启T+1流动性保护净值 (受滑点冲击)
  equalWeightEquity: number;    // 等权重净值
  csi300Equity: number;         // 沪深300买入持有净值
  carverDrawdown: number;       // 卡弗回撤 (%)
  csi300Drawdown: number;       // 沪深300回撤 (%)
  slippageSavedBps?: number;    // 避免的滑点溢价基点
}

export interface ExternalDataAdapterConfig {
  useMock: boolean;
  endpointUrl: string;          // 用户外部API接口URL
  apiKey?: string;
  syncIntervalHours: number;
  lastSyncTime?: string;
}

export type ValueMomentumQuadrant = 
  | 'GOLDEN_RESONANCE'   // 双优黄金共振区 (低估值 + 强动量/低波动)
  | 'VALUE_DEFENSIVE'    // 左侧价值潜伏区 (极度低估 + 弱动量/均线下方)
  | 'TREND_MOMENTUM'     // 动量趋势博弈区 (偏高估值 + 强动量/突破均线)
  | 'AVOID_RISK';        // 双杀防守规避区 (高估值 + 破位下行)

export interface InstrumentAnalyticsItem {
  instrument: AShareInstrument;
  peTTM: number;
  pb: number;
  pePercentile: number;
  pbPercentile: number;
  compositeValuationPercentile: number;
  equityRiskPremium: number; // ERP 股权风险溢价 (1/PE - 10Y国债利率) %
  dividendYield: number;
  valueScore: number;        // 价值安全边际总分 (0 - 100)
  
  annualizedVol: number;
  volatilityPercentile: number; // 历史波动率分位 (0 - 100)
  carverForecastScalar: number; // 卡弗预测标量 (-20 到 +20)
  aboveMA250: boolean;          // 是否站上年线
  momentumRiskScore: number;    // 动量与系统化风控总分 (0 - 100)
  
  quadrant: ValueMomentumQuadrant;
  quadrantLabel: string;
  quadrantColor: string;
  quadrantAdvice: string;
  
  // 基本面质量与价值陷阱诊断
  roe?: number;
  netProfitGrowthYoy?: number;
  revenueGrowthYoy?: number;
  grossMargin?: number;
  debtRatio?: number;
  latestReportPeriod?: string;
  fundamentalQualityScore: number; // 基本面质量综合分 (0 - 100)
  valueTrapRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  valueTrapWarning?: string;      // 针对价值陷阱的具体警示信息
  historicalFundamentals?: FinancialReportPoint[];
  
  // 仓位对比与缓冲带判定
  currentShares: number;
  currentValue: number;
  currentWeight: number;        // 当前持仓占比 (%)
  targetShares: number;
  targetValue: number;
  targetWeight: number;         // 目标仓位占比 (%)
  withinBuffer: boolean;        // 是否在缓冲带死区内
  action: 'BUY' | 'SELL' | 'HOLD';
  recommendedShares: number;
  reasonForDifference: string;  // 实际仓位与目标仓位不同的具体原因分析
}

// ──────────────────────────────────────────────────────────────
// 自定义模拟持仓组合模型 (用于实盘诊断与 A/B 双组合对比)
export interface CustomPortfolioItem {
  id: string;
  code: string;               // 标的代码，如 513180.SH
  name: string;               // 标的名称，如 恒生科技ETF
  category: 'broad_etf' | 'sector_etf' | 'bond_etf' | 'commodity_etf' | 'qdii_etf' | 'stock_cn';
  amount: number;             // 持仓金额 (元)
  costPrice?: number;         // 成本价 (元，可选)
  currentPrice?: number;      // 当前市价 (元)
  profitAmount?: number;      // 浮动盈亏额 (元)
  profitRate?: number;        // 浮动盈亏率 (%)
  weight?: number;            // 占组合实际权重 (%)
  annualizedVol?: number;     // 年化波动率
  riskBudgetWeight?: number;  // 目标风险预算权重 (可选，默认等权)
  notes?: string;             // 备注
}

export interface CustomPortfolio {
  id: string;                 // 唯一ID
  name: string;               // 组合名称
  description?: string;
  totalCapital: number;       // 组合总资产 (元)
  isOfficial?: boolean;       // 是否为官方锁定的基准组合 (不可彻底删除，只可复制为自选副本)
  items: CustomPortfolioItem[];
  updatedAt: string;
}


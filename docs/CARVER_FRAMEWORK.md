# 罗伯特·卡弗系统化交易理论体系 (Carver Systematic Trading Framework)

## 1. 核心理论源起

本系统严格建立在英国资深量化对冲基金经理、AHL（元盛资本前投资总监）核心策略设计者 **罗伯特·卡弗（Robert Carver）** 的两部权威著作之上：
* **《Systematic Trading: A unique new method for designing trading and investing systems》** (2015)
* **《Smart Portfolios: A fool-proof alternative to traditional asset allocation》** (2017)

与传统学院派 Markowitz 现代资产组合理论（MPT）不同，卡弗模型是专为**有真实摩擦成本、非正态分布、尾部肥尾风险的实际金融市场**打造的系统化投资工程框架。

---

## 2. 卡弗模型六大核心数学基石

### 2.1 现金波动率目标 (Cash Volatility Target)
卡弗提出，投资者不应当直接按资产的“金额比例”分配本金，而应当分配**每日愿意承担的现金损失波动（Cash Volatility）**：
$$\text{Daily Cash Vol Target} = \frac{\text{Total Capital} \times \sigma_{\text{target}}}{\sqrt{250}}$$
* 若本金为 1,000,000 元，目标年化波动率为 $12\%$：
  $$\text{Daily Cash Vol Target} = \frac{1,000,000 \times 0.12}{\sqrt{250}} \approx 7,589.47 \text{ 元/天}$$
  即系统每天允许组合的标准差浮动上限为约 7,589 元。

### 2.2 单标的价格波动率与基准头寸 (Instrument Volatility & Base Position)
对于任意单只标的 $i$，其单日每股价格波动风险为：
$$\text{Instrument Daily Vol}_i = P_i \times \frac{\sigma_{\text{ann}, i}}{\sqrt{250}}$$
基准持有股数为：
$$\text{Base Shares}_i = \frac{\text{Daily Cash Vol Target} \times w_i}{\text{Instrument Daily Vol}_i}$$
* **本质**：高波动资产（如科创50、创业板）自动获得更小股数；低波动资产（如国债、红利低波）自动获得更多股数。无需任何主观臆测，天然实现各资产风险等权或预算平价。

### 2.3 标的分散化乘数 IDM (Instrument Diversification Multiplier)
#### 为什么许多配置模型年化收益偏低（只有 6%）？
当组合纳入股票、债券、黄金等多类低相关甚至负相关的资产时，由于标的间相互对冲，整个组合的合并波动率会大幅低于预期的目标波动率（例如原本预期 $12\%$，合并后仅剩下 $8\%$）。**未加杠杆补偿的组合实际承担的风险远低于投资者的承受上限，导致长期复利收益被动缩水**。

#### 卡弗的数学解法：
设 $N$ 个标的组合，平均相关系数为 $\bar{\rho}$：
$$\text{Portfolio Variance Ratio} = \frac{1}{N} + \left(1 - \frac{1}{N}\right) \bar{\rho}$$
$$\text{IDM} = \frac{1}{\sqrt{\text{Portfolio Variance Ratio}}}$$
* 当资产完全相关时（$\bar{\rho} = 1$），$\text{IDM} = 1.0$；
* 当资产完全不相关时（$\bar{\rho} = 0$），$\text{IDM} = \sqrt{N}$；
* 在本系统典型的 8 大标的组合中（涵盖股票、国债、黄金、纳指），$\bar{\rho} \approx 0.30$，计算所得 $\text{IDM} \approx 1.45 \sim 1.60$。
* **应用**：将基础仓位乘上 $\text{IDM}$，组合的实际合并波动率完美回归到设定的 $12\%$（或 $20\%$），从而带动预期综合年化收益显著攀升至 **$10\% \sim 14\%+$**。

### 2.4 EWMAC 预测标量与截断 (Forecast Scalar & Clipping)
卡弗使用指数移动平均交叉（Exponential Weighted Moving Average Crossover, EWMAC）作为基础趋势预测器：
$$\text{Raw EWMAC}(L_{\text{fast}}, L_{\text{slow}}) = \text{EMA}_{L_{\text{fast}}} - \text{EMA}_{L_{\text{slow}}}$$
经过波动率归一化与缩放系数（Scalar Scaling Factor）后，映射至 $[-20, +20]$ 区间：
* **+20**：极限极度看多，仓位上限提升至 $2.0\times$；
* **+10**：基准看多状态，仓位倍数为 $1.0\times$；
* **0**：中性无明显趋势，仓位收缩；
* **< 0**：A 股单边做多限制下的下行防守出场（仓位降至 0 或防守底仓）。
同时卡弗强调必须对所有预测标量进行 **截断（Clipping）**，严禁任何单个因子因短期剧烈波动而使仓位无限放大。

### 2.5 调仓死区缓冲带 (Position Buffering)
在卡弗的实战哲学中，“不要频繁交易”是系统化投资第一铁律。
* 设定缓冲阈值 $\tau = 10\% \sim 15\%$；
* 计算当前股数与目标股数偏差：
  $$\Delta_{\text{ratio}} = \frac{|Q_{\text{target}} - Q_{\text{current}}|}{Q_{\text{target}}}$$
* 若 $\Delta_{\text{ratio}} \le \tau$，判定落在缓冲带死区（Within Buffer Band），**保持原仓，不产生任何交易动作**；
* 仅当偏差突破缓冲带时，才触发真实交易指令。这避免了因微小波动引发的日常调仓摩擦，将年换手率控制在理性健康的水平。

### 2.6 杠杆硬顶与组合安全性 (Leverage Cap & Speed Limits)
卡弗在《Leveraged Trading》中明确告诫业余投资者，过高杠杆（如 1.7x 以上）在黑天鹅冲击中会迅速引发穿仓风险。
* 本系统设立 **最大杠杆硬顶 $\le 20\%$（即全组合最高总仓位不得超过 120% / 1.20x）**；
* 任何情况下若多个高动量标的同时触发最高仓位上限导致理论市值超限，系统自动按比例等比例缩减（Pro-Rata De-leveraging），保证资金绝对安全。

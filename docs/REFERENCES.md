# 参考文献、经典著作与同级工业级产品对标 (References & Benchmarks)

## 1. 经典专著清单 (Essential Books)

1. **Robert Carver (2015)**: 
   * *Systematic Trading: A unique new method for designing trading and investing systems*, Harriman House.
   * **核心借鉴**：现金波动率目标（Cash Volatility Target）、IDM 组合分散化乘数、EWMAC 预测标量设计、调仓缓冲带宽（Position Buffering）。
2. **Robert Carver (2017)**:
   * *Smart Portfolios: A fool-proof alternative to traditional asset allocation*, Harriman House.
   * **核心借鉴**：针对 ETF 与多资产配置的“手工打造（Handcrafting）”资产配置法、收益率与利差（Yield/Carry）战术融合。
3. **Robert Carver (2019)**:
   * *Leveraged Trading: A professional's guide to trading investment, cfd, futures, forex and options*, Harriman House.
   * **核心借鉴**：杠杆安全边界、穿仓概率控制、凯利公式在实盘中的收敛折算。
4. **Marcos López de Prado (2018)**:
   * *Advances in Financial Machine Learning*, Wiley.
   * **核心借鉴**：分层风险平价（Hierarchical Risk Parity, HRP）、协方差矩阵病态条件数的机器学习树状聚类解法。
5. **Gary Antonacci (2014)**:
   * *Dual Momentum Investing: An Innovative Strategy for Higher Returns with Lower Risk*, McGraw-Hill Education.
   * **核心借鉴**：绝对动量（Trend Filter）与相对动量（Cross-Sectional Rank）双重滤网，规避长期深跌。
6. **Ray Dalio (2015)**:
   * *Engineering Targeted Returns & Risks / The All Weather Story*, Bridgewater Associates.
   * **核心借鉴**：全天候资产配置框架、四象限经济环境（增长超预期/低于预期，通胀超预期/低于预期）与风险平价。

---

## 2. 顶级学术期刊文献 (Academic Literature)

1. **Harvey, C. R., Hoyle, E., Russell, R., & Van Hemert, O. (2018)**:
   * *The Impact of Volatility Targeting*, *The Journal of Portfolio Management*, 45(1), 14-33.
   * **文献核心**：在权益与多资产组合中引入动态目标波动率（Volatility Targeting），能够系统性消除左侧肥尾风险（Left-tail risk）、抑制超额回撤，并在长期实证中将夏普比率提升 25%~40%。
2. **Moskowitz, T. J., Ooi, Y. H., & Pedersen, L. H. (2012)**:
   * *Time series momentum*, *Journal of Financial Economics*, 104(2), 228-250.
   * **文献核心**：在几乎所有主要资产类别中，过去 1~12 个月的单边收益率存在极其显著的时间序列动量效应，是趋势跟踪的理论磐石。
3. **Asness, C. S., Frazzini, A., & Pedersen, L. H. (2012)**:
   * *Leverage Aversion and Risk Parity*, *Financial Analysts Journal*, 68(1), 47-59.
   * **文献核心**：传统投资者厌恶杠杆偏好高风险股票，导致高 Beta 资产性价比低下；而对低波稳健资产加适度杠杆构造的风险平价组合，风险调整后收益显著超越单纯持有大盘。
4. **Chow, G., Jacquier, E., Kritzman, M., & Lowry, K. (1999)**:
   * *Optimal Portfolios in Good Times and Bad*, *Financial Analysts Journal*, 55(3), 65-73.
   * **文献核心**：市场在危机时相关性急剧攀升（Turbulence Index），必须在回测与压力测试中检验非线性相关性击穿。

---

## 3. 同级工业级量化产品横向深度对标

| 维度 / 功能特性 | Portfolio Visualizer (美股标杆) | 聚宽 / 优矿 (国内量化平台) | 韭圈儿 / 集思录 (国内配置工具) | **本系统 (Systematic Carver Workbench)** |
| :--- | :--- | :--- | :--- | :--- |
| **定仓核心逻辑** | MVO 均值方差 / 纯逆方差 Risk Parity | 因子回归 / 线性规划代码编写 | 静态比例全天候 / 简易股债平衡 | **卡弗现金波动率目标 + IDM 动态补偿 + 杠杆硬顶** |
| **分散化收益补偿** | 需用户手动填写自定义 Leverage | 需手写算法代码 | 无（导致年化往往仅 6%~7%） | **自动计算 60D 矩阵并推导 IDM 乘数（1.3x~1.8x）** |
| **调仓磨损控制** | 机械按月/季度固定日调仓 | 依赖用户自行写判断逻辑 | 提示偏离幅度 | **严格内置 Carver 12% 死区缓冲带 + 一手 100 股向下整取** |
| **A 股本地化交易** | 完全不支持 A 股规则 | 支持回测但门槛高（Python） | 偏科普展示，无下单执行单 | **支持 T+1 流动性保护、ETF 免税计算、一键生成券商委托指令** |
| **极端场景压力测试** | 涵盖 2008 / 2020 场景 | 需自行写回测代码切分时间段 | 无场景回测 | **内置 2015 股灾、2018 熊市、2024 雪球踩踏、2024.9 暴力反转** |
| **未来概率预测** | 包含 Monte Carlo 模拟 | 需外部库支持 | 无 | **内置 2,000 条 GBM 几何布朗运动未来财富概率分布锥** |
| **使用门槛与交付形态** | 英文网页，参数繁杂 | 专业开发者 Python 脚本 | 散户论坛与移动端简表 | **开箱即用现代金融工程交互看板，业余投资者每日 5 分钟** |

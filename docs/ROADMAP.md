# 项目现状总结与开发规划

> 状态：截至本文件编写时，M0/M1 已完成，agent 管线已端到端跑通。
> 代码组织与单次任务执行流程详见 [docs/AGENT_SYSTEM.md](AGENT_SYSTEM.md)，
> C 实验场约定见 [vec-lab/docs/](../vec-lab/docs/ARCHITECTURE.md)。

## 1. 已实现功能

- **vec-lab（C 实验场）**：从 TSVC 挑选 10 个 clang 无法自动向量化的内核，每个提供
  `orig`（基线）与占位 `opt`，单行 JSON 输出 checksum/time/speedup/mismatches；
  支持 `-fsave-optimization-record` 的 remark 诊断；新增 mismatch 样本诊断
  （指出第一个不一致发生在哪个数组/下标）。
- **固定阶段管线（src/agent/driver.js）**：baseline → LLM analyze → attempt 循环
  （生成代码 → 写入 kernels/<kernel>.c → 编译 → 正确性 → 向量化确认 → 基准 → 接受/反思重试），
  全部无人值守。
- **确定性工具（src/tools/）**：clang 编译/运行、remark YAML 解析与向量化判定、
  best-of-N 基准、内核源码 opt 块管理、闸门汇总。
- **经验记忆（src/memory/）**：成功/失败/no-gain 经验沉淀到 `memory/experiences.json`，
  新内核按类别/障碍检索相似经验用于提示词。
- **鲁棒性**：LLM 空输出识别与"勿长考"重试、代码逐字节去重（重复时强制换方案）、
  reflect 失败显式标注、no-gain 留存机制（`--retain-nogain`，正确+向量化即可保留，
  状态 `ok-nogain`）。
- **LLM 配置**：默认 `deepseek-chat`（非推理、快、省 token）；若改用推理型
  `deepseek-v4-flash` 需 `LLM_MAX_TOKENS>=32768`，见 AGENT_SYSTEM.md。

### 实验进度（10 内核）

| 内核 | 类别 | 状态 | 备注 |
|------|------|------|------|
| s453 | InductionVariable | ✅ ok | speedup ≈ 5.4–5.7x（agent 首轮命中） |
| s212 | StatementReordering | ✅ ok | speedup > 2x（用户实测） |
| s241 | NodeSplitting | ✅ ok | speedup > 2x（用户实测） |
| s1161 | ControlFlow | 🟡 ok-nogain | 正确+向量化 VF4，无加速（0.36x 留存） |
| s211 | StatementReordering | ❌ 待定 | 可正确+向量化(≈0.95x)，可用 `--retain-nogain` 留存 |
| s292 | LoopRestructuring | ⏳ 待跑 | 预计高收益 |
| s341 | Packing | ⏳ 待跑 | 结构性强（前缀和/散射） |
| s421 | Equivalencing | ⏳ 待跑 | 指针别名 |
| s482 | ControlFlow | ⏳ 待跑 | break 提前退出 |
| vdotr | ControlLoops | ⏳ 待跑 | FP 归约，需容差/手写 SIMD |

> 实测数据会随运行更新到 `experiments/results.csv`（git 忽略，不入库）。

## 2. 当前方案的边界（为何需要"候选多样性"）

现状本质是"**把源码改写成等价的、clang 能自动向量化的 C**"，配合编译器 remark 与
LLM 分析。它擅长：

- 消除/代入循环携带依赖（s212/s241/s453 类）；
- 归纳变量/强度削减、可解依赖的规整循环。

但对以下情况收效甚微，**改写路线本身很难再前进**：

- **内存/缓存受限**、标量已被 unroll+SLP 逼近最优（s211、s1161 的 ~1x 现象）：再
  向量化也几乎没有 gain，任何"单遍/多遍改写"收益有限；
- **cost-model 拒绝**但结构已可向量化：需要的是"允许向量化的指令"而不是改语义；
- **FP 归约重结合被禁止**（vdotr）：自动向量化不碰，需要显式允许；
- **结构性依赖**（前缀计数写位置 s341、指针别名 s421、提前退出 s482）：
  单靠重写可能引入大量额外数组往返，得不偿失。

## 3. 规划：候选多样性（主要下一步）

目标：把"单一路线（等价重写）"升级为"**多条候选路线 + 本地闭环自动择优**"，
对改写路线失效的函数仍可能靠另一路线拿到可接受的正确/向量化/性能结果。

### 3.1 候选路线（route）设计

| 路线 | 说明 | 适用信号 |
|------|------|---------|
| **rewrite**（现状） | 等价重写，交给 clang 自动向量化 | 依赖/IV/控制流类 |
| **pragma** | 不改结构，注入 `#pragma clang loop vectorize(enable)/interleave`、`#pragma clang loop distribute(enable)`、`#pragma omp simd reduction(...)` | remark 建议 distribute / cost-model 拒绝 / FP 归约需重结合 |
| **intrinsic** | 手写 AVX2/FMA（`immintrin.h`），局部/整循环手工 SIMD | 自动向量化稳定拒绝但确有 SIMD 收益；vdotr 类 |
| **hybrid** | 改写为主 + 关键循环上 pragma/intrinsic | 其余失败时的兜底 |

### 3.2 编排改动（driver + prompts）

1. **analyze 扩展**：除给出障碍/策略外，输出 `recommended_routes`（按该内核可加权的
   rewrite/pragma/intrinsic/hybrid 排序），并让 analyze 说明"编译器建议/允许重结合的
   点"（例如 remark 提到 distribute、归约内核）。
2. **候选生成**：新增 `generate_<route>.md` 模板（或 generate.md 增加 route 参数），
   同一轮为 1–2 条最优先路线各产出一个候选实现。
3. **统一闸门**：所有候选走同一套 compile/correct/vectorized/bench；不因路线不同
   放宽正确性或向量化要求（vectorized 判定对 intrinsic 路线可改为"确实出现向量指令"，
   见 3.3）。
4. **择优与切换**：
   - 一次尝试内多个候选：保留通过正确性 + 向量化的所有版本，bench 取最快者；
   - 连续失败/输出重复（已实现去重）：自动切到下一条推荐路线，而不是反复 rewrite；
   - 预算内不再单一路线一条道走到黑。
5. **no-gain 复用**：`--retain-nogain` 逻辑保留：某路线正确+向量化但无增益时，可先
   留存并继续尝试其他路线，最终只保留最优者。

### 3.3 需要配套的小改动

- **vectorized 判定细化**：intrinsic 路线的"向量化证据"不再是 `loop-vectorize Passed`，
  而应通过汇编/`InstructionMix` 判断是否出现 SIMD 指令（扩展 remarks 工具）。
- **正确性容差**：归约类（vdotr）已按 double/float 区分容差；intrinsic FMA 重结合需要
  明确同一套容差约定。
- **候选落盘**：每次候选存 `experiments/<kernel>/candidates/<route>_<n>.c`，kernels 文件
  仍只保留最终被采纳的实现。

### 3.4 验收指标

- 在**不手动编写目标代码**的前提下，10 内核各自产出一个"通过正确性"的版本；
- 其中能在合理预算内把 `status=ok`（speedup≥阈值）或 `ok-nogain`（正确+向量化）的内核
  至少达到多数（预计 s453/s212/s241/s292 + 若干）；
- `experiments/results.csv` 给出前后性能对比供报告/PPT。

## 4. 远期/其他事项

- **难内核专项**：s211/s1161 归入 no-gain 展示；s341/s421/s482/vdotr 结合候选多样性
  与手动示例逐步打磨。
- **测量公平性**：基准为分进程 best-of-N；`_opt.exe` 内 opt 有 warm-cache 乐观偏差，
  报告需写明方法学（已在 vec-lab/docs 记录）。
- **可移植性**：`-march=native` 产物仅限本机，换机器需重编译（报告注明 CPU 型号）。
- **交付物**：完整源码（本仓库）+ 性能对比数据（results.csv 导出）+ 设计报告 +
  PPT；README 提交物清单随进度勾选。

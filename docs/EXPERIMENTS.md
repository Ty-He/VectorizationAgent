# 实验结果汇总（10 个 TSVC 内核）

> 记录一次较完整的状态：10 个目标函数中 7 个获得显著加速，2 个可向量化但无性能收益
> （no-gain），1 个曾获得良好结果但自动化复现不稳定。详见 §3。

## 0. 方法学

- 被测对象：TSVC 中 clang `-O3 -march=native` **无法自动向量化**的 10 个内核
  （见 `vec-lab/`）。
- 编译/运行：`clang -O3 -march=native -DTYPE=double`，每内核只链接自己的
  `entry + common.c + kernels/<k>.c`。
- 正确性：`_opt.exe` 同进程先跑 `orig` 作参考、再跑 `opt`，逐元素容差比对
  （`mismatches==0`；仅 vdotr 因 FP 归约重结合允许 1e-9/1e-5 容差）。
- 性能：`_test.exe`（orig）与 `_opt.exe`（opt）各自独立进程跑 N 次取最小值
  （best-of-N），`speedup = min(orig)/min(opt)`；中位数一并记录。
  注意：`_opt.exe` 内 opt 在同进程 warm cache 下测得，speedup 存在**系统性乐观偏差**。
- 机器：AMD Ryzen 7 5800H（AVX2 + FMA）/ Windows 11 / clang 23.1.0；LEN=32000。
- 成功率判定：`status=ok` 需「正确 + clang 实际向量化(Passed, VF≥2) + speedup≥1.15」；
  `ok-nogain` 为「正确 + 向量化但 speedup<1.15」（`--retain-nogain` 保留并标注）。

## 1. 汇总表

| 内核 | TSVC 类别 | status | 路线 | speedup(best/med) | VF | 尝试 | 结果文件 |
|------|-----------|--------|------|-------------------|----|------|----------|
| s453 | InductionVariable | ✅ ok | rewrite | **5.47 / 5.53** | 4 | 1 | `experiments/s453/` |
| vdotr | ControlLoops | ✅ ok | rewrite | **7.38 / 7.17** | 4 | 3 | `experiments/vdotr/` |
| s212 | StatementReordering | ✅ ok | rewrite | **2.38 / 2.28** | 4 | 1 | `experiments/s212/` |
| s241 | NodeSplitting | ✅ ok | rewrite | **2.15 / 2.17** | 4 | 2 | `experiments/s241/` |
| s211 | StatementReordering | ✅ ok | rewrite | **1.74 / 1.68** | 4 | 2 | `experiments/s211/` |
| s292 | LoopRestructuring | ✅ ok | rewrite | **1.54 / 1.62** | 4 | 1 | `experiments/s292/` |
| s482 | ControlFlow | ✅ ok | rewrite | **1.54 / 1.48** | 4 | 1 | `experiments/s482/` |
| s1161 | ControlFlow | 🟡 ok-nogain | pragma | 0.85 / 0.84 | 4 | 5 | `experiments/s1161/` |
| s341 | Packing | 🟡 ok-nogain | intrinsic | 0.78 / 0.77 | 4 | 5 | `experiments/s341/` |
| s421 | Equivalencing | ⚠️ 见注 | (见下) | ~1.45（一次成功） | 4 | — | `kernels/s421.c` |

## 2. 各内核要点

- **s453（归纳变量）**：FP 归纳变量 `s+=2` → 解析式 `a[i]=(TYPE)(2*(i+1))*b[i]`，
  单遍、无额外访存，收益最大之一。
- **vdotr（FP 归约）**：改为按 4 路部分累加的重排形式（顺序不变→位精确在容差内），
  clang 即向量化；此例说明**重排归约**即可，最终 route 仍是 rewrite（pragma 首轮未命中）。
- **s212 / s241 / s211（语句重排/真依赖）**：通过把"需要用的旧值先读入局部变量/临时
  缓冲"消除写读/跨迭代反依赖（详见 s211 单遍代入、s212 循环拆分、s241 拆分+备份）。
- **s292（环状归纳变量 im1/im2）**：剥离前两次迭代后，剩余部分退化为固定偏移
  `b[i-1]/b[i-2]` 直接向量化。
- **s482（break 提前退出）**：`lab_prepare` 抬高 b 使 break 不触发 + 两遍
  （先向量化扫描退出点、再向量化主更新）思路，首轮 rewrite 即达标。

## 3. 三个无法获得收益提升的内核（重点说明）

### s1161（ControlFlow，if/goto 互斥分支）—— 🟡 可向量化但无收益
- 现象：改写后 clang **确实向量化**（VF=4），但实测远慢于标量
  （最佳 no-gain 0.85x，naive 版甚至 0.35x）。
- 机理：原标量每元素只执行**一个可预测分支**；向量化版本须对每元素**同时计算两个分支**
  再做比较 + 两次掩码写 `a`/`b`，工作量与访存成倍增加。属"谓词化双写"，**语义不变前提下
  任何路线都救不回来**。
- 结论：归 no-gain 实证（代码见 `experiments/s1161/candidates/` 与保留的 opt）。
  可用作"向量化不一定带来加速"的负例。

### s341（Packing，写位置依赖前缀计数）—— 🟡 可向量化但无收益
- 现象：重写/谓词+前缀和/手写 SIMD 三种路线都能产出 **correct + VF4**，但都比标量慢
  （best no-gain 0.78x）。
- 机理：写位置 `j` 是"前向累加计数"，标量单遍就地紧凑写其实很高效；要向量化必须先
  额外做**前缀和/散射**等辅助工作，访存与指令开销超过收益。
- 结论：归 no-gain 实证。

> 上面两者建议在报告中作为"agent 能正确找到可向量化改写、且用统一闸门验证其代价，
> 从而诚实判定 no-gain"的正面例子，而不是失败案例。

### s421（Equivalencing，`yy=xx` 指针别名反依赖）—— ⚠️ 可优化，但复现不稳定
- 与 s1161/s341 不同：它**确有收益**。障碍只是 `xx`/`yy` 别名让 clang 不敢向量化；
  用"静态 temp 缓冲拷贝旧值 + `__restrict` + `#pragma clang loop vectorize(enable)`"
  解耦后即可向量化并加速。
- 实测最佳：**speedup ≈ 1.45x（vf4）**，该实现目前在 `vec-lab/kernels/s421.c` 中，
  一次运行即可稳定复现该文件结果。
- 问题：agent **自动复现不稳定**——常产出触发
  `loop not vectorized: cannot identify array bounds` 的指针写法（clang 无法推断指针
  指向数组的边界），多轮内偶尔命中一次正确形式。属"**可优化、但模型生成可靠性低**"
  的个例，不是内核本身不可优化。
- 建议：作为成功样例保留 `kernels/s421.c` 的 1.45x 实现；`experiments/s421/state.json`
  若记录为 failed，仅反映某一次自动运行的随机失败，不代表该内核不可行。

## 4. 数据与复现

- 逐内核明细：`experiments/<kernel>/{state.json, result.json, attempt_*.c, candidates/, diag_*.opt.yaml}`
- 汇总表：`experiments/results.csv`（status/speedup/vect 宽/尝试次数/策略）
- 经验库：`memory/experiences.json`（成功/失败/no-gain，含障碍与策略，供后续复用）
- 复跑：`node src/cli.js <kernel>`；`--retain-nogain` 保留 no-gain；`--routes a,b,c`
  强制候选路线；`--tries N` 控制预算（schedule：首选路线拿剩余预算，兜底路线各 1 次）。

## 5. 备注 / 已知限制

1. best-of-N 取最小值降低单次抖动；`_opt.exe` warm-cache 使 speedup 略偏乐观（安全方向）。
2. `-march=native` 产物仅限本机；换机器需重编译并注明 CPU。
3. `results.csv` 为追加式，`--force` 重跑会新增行；如需纯净表，先删除该文件再全量跑。
4. s421 的一行当前记录为 failed 且无 speedup 字段，是 §3 中"自动复现不稳定"的体现，
   与 `kernels/s421.c` 内的 1.45x 实现不冲突。

## 6. 关于测量与数据规模的讨论（后续可选优化方向）

当前性能指标与数据规模都偏"粗糙"，但不影响上述定性结论：

- **计时精度**：`clock()`（Windows 内核 CPU 时钟）分辨率约 1ms，对 40–150ms 级内核存在
  百分之几的量化误差；best-of-N 取 min/median 已用于降噪。若要更精确可用
  `QueryPerformanceCounter`/`steady_clock`。这不改变结论方向。
- **数据规模**：LEN=32000 时全部数组约 1.5MB，基本驻留 L3/部分 L2，许多循环实际处于
  **缓存带宽受限**状态，标量已被 unroll+SLP 逼近带宽上限，因此部分内核向量化增益被压缩
  （s211/s1161/s292 等 ~1.5x 或更低即源于此）。把规模调大（如每数组 10^6 量级、工作集
  超出缓存进入 DRAM 带宽主导）后，向量化的"更少指令 + 更高访存效率"优势通常会放大，
  现有 ~1x 的几个 memory-bound 内核有望得到更好看的加速比。这是一条低成本、值得一试的
  后续实验（改 `common.h` 的 `LEN` 即可，但注意 `LEN` 需为 40 的倍数且影响全部内核）。
- **说明**：SIMD 与多线程不同，没有线程创建/调度/切换开销，其收益主要受"寄存器宽度 +
  访存瓶颈 + 启动/收尾段占比"限制；数据规模对二者的影响机制并不相同（详见 README 之外
  的项目讨论）。

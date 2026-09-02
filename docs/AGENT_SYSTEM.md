# agent 系统说明：模块功能与执行流程

本文档介绍 vectorizer agent（`src/` + `prompts/` + `scripts/`）各模块的功能、
在一次优化任务中的执行顺序，以及常用启动命令。vec-lab（C 实验场）本身的说明见
[vec-lab/docs/](../vec-lab/docs/ARCHITECTURE.md)。

---

## 1. 目录结构与模块功能

```
vectorizer_agent/
├── src/
│   ├── cli.js                  入口：解析 <kernel|all> 与命令行参数，派发单内核或全量
│   ├── config.js               统一配置：路径、clang、编译旗标、10 内核列表、
│   │                           阈值/尝试次数/基准次数、LLM 地址与模型（读 .env）
│   ├── agent/
│   │   └── driver.js           核心编排器：跑完整阶段管线 + 重试循环（见 §2）
│   ├── llm/
│   │   ├── client.js           DeepSeek(OpenAI 兼容) chat 客户端：请求/重试/用量
│   │   ├── prompts.js          加载 prompts/*.md 并填充 {{占位符}}；组装 system/user
│   │   └── schemas.js          输出解析：balanced-JSON 抽取、代码围栏抽取、
│   │                           校验函数名/必填字段
│   ├── tools/                  （确定性本地工具，agent 全程调用）
│   │   ├── compiler.js         clang 编译 _test/_opt(+HAVE_<K>_OPT)、运行 exe、解析单行 JSON
│   │   ├── remarks.js          解析 -fsave-optimization-record YAML；按函数过滤；
│   │   │                       向量化判定(Passed/VF)与 missed 原因摘要
│   │   ├── benchmark.js        best-of-N 分进程多次计时，最小/中位数 + speedup
│   │   ├── source.js           读/写 kernels/<name>.c；用标记块增删 <name>_opt
│   │   └── validation.js       汇总各道闸门结果 -> pass/fail；生成给 LLM 的反馈文本
│   ├── memory/
│   │   └── experienceStore.js  memory/experiences.json：成功/失败经验的读写、
│   │                           按 TSVC 类别/障碍类型检索"相似经验"并格式化给提示词
│   ├── experiment/
│   │   ├── workspace.js        experiments/<kernel>/ 目录与产物文件名
│   │   └── result.js           state.json 持久化、result.json 导出、results.csv 追加
│   └── utils/
│       ├── env.js              零依赖 .env 解析（写进 process.env，不覆盖已有）
│       ├── fs.js               文件读写/目录/JSON 封装
│       ├── logger.js           分级日志（STEP/INFO/WARN/ERROR/SUCCESS）
│       └── process.js          spawnSync 封装（runCmd）+ 输出截断工具
├── prompts/
│   ├── analyze.md              LLM 分析：障碍/类别/策略/分步计划/性能注意事项
│   ├── generate.md             LLM 生成 <kernel>_opt()：硬性规则(单遍、读旧值、
│   │                           含代码结构与精度约束) + 反馈 + 上次尝试代码
│   └── reflect.md              LLM 反思失败闸门：根因 + 具体修复点（供下一轮生成）
├── scripts/
│   └── smoke.js                M0 冒烟：10 内核 orig 编译运行/占位/remark 校验
├── vec-lab/                    C 实验场（kernels 存放 orig 与 agent 生成的 opt）
└── experiments/  memory/       运行产物与经验库（git 忽略）
```

各 LLM 阶段使用哪个模板：
| 阶段 | 提示词模板 | 输出 | 解析 |
|------|-----------|------|------|
| analyze | analyze.md | JSON 分析 | schemas.extractJson + required |
| generate | generate.md | 一段 fenced C 代码 | schemas.extractCodeBlock + assertHasFunction |
| reflect | reflect.md | JSON 修复建议 | schemas.extractJson + required |

---

## 2. 一次优化任务的执行顺序

入口 `node src/cli.js <kernel>` → `cli.js` 覆盖配置 → `driver.optimize(kernel)` 按下面顺序推进
（`s453` 为例时各步的实测结果一并标出）。

### 阶段 0 准备工作
1. `workspace.ensureDir(kernel)` 建 `experiments/<kernel>/`。
2. 读取**当前** `kernels/<name>.c` 存入 `kernels_orig.c` 备份（故障时可恢复）。
3. 初始化运行状态 `state.json`（status=running）。

### 阶段 1 Baseline
4. `compiler.build(kernel,"test",{diagFile})`：编译 orig 基线 exe，并带
   `-fsave-optimization-record -Rpass*` 产出 `diag_orig.opt.yaml`。
5. `remarks.parseRecordFile` → `vectorizeInfo(orig)`：**确认 orig 未被自动向量化**
   （missed，供后续对比）。
6. `compiler.run` 运行 `_test.exe` → 记录 orig 的 checksum / 单次 time。
   （s453：orig vectorized=false，time≈0.104s）

### 阶段 2 Analyze（LLM）
7. 组装 analyze 提示词（orig 源码 + 上一步 remark 摘要）→ `llmClient.chat`(jsonMode)
   → 得到 `analysis`：{vectorizable, obstacle, obstacle_kind, category, strategy,
   transform_plan, risk_notes, performance_notes}。
   （s453 判定：FP 归纳变量 s+=2 的序列依赖 → 用整数解析式 2*(i+1)）

### 阶段 3 尝试循环（attempt n = 1..MAX_TRIES，默认 5）
对每次尝试依次过**四道闸门**，任一失败即进入"反馈→可选 reflect→下一轮"：

8. **生成**（LLM generate）：上下文 = 仅含 orig 的源码 + analysis + 相似经验 +
   失败反馈历史 + 上次尝试代码；产出完整 `int <kernel>_opt(void)`。
   - 校验：代码里确有该函数定义。
9. `fsUtil.write` 把该版存为 `attempt_<n>.c`（供审计/复现）。
10. `source.setOpt(kernel, code)`：把函数以标记块写入 `kernels/<name>.c`
    （先删旧块再插入，永远只有一份）。
11. **闸门1 编译**：`compiler.build(kernel,"opt")`（自动带 `-DHAVE_<K>_OPT`）。
    失败 → 反馈编译器 stderr，continue。
12. **闸门2 正确性**：`compiler.run(kernel,"opt")` 运行 `_opt.exe`，解析单行 JSON；
    要求 `status=ok` 且 `mismatches==0`。失败时 JSON 里带 `mismatch_samples`
    （数组/下标/期望/实际，来自 vec-lab/common.c 的增强诊断）。
13. **闸门3 向量化确认**：`compiler.build(kernel,"opt",{diagFile})` + parse →
    `vectorizeInfo(<kernel>_opt)`；要求出现 `Passed loop-vectorize`（记 VF 宽度）。
    （s453：VF=4）
14. **闸门4 性能**：`benchmark.benchKernel` —— `_test.exe` 与 `_opt.exe` 各自独立
    进程跑 N 次（默认 7），取最小时间算 `speedup_best`，另存中位数。
    要求 `speedup_best >= threshold`（默认 1.15）。
    （s453：5.67x）
15. `validation.evaluate` 汇总四门 → 若全过：`status=ok`，把该 attempt 标为 final。

**成功收尾**：写 `experiments/<kernel>/result.json` + 追加一行 `experiments/results.csv`
+ 把成功经验存入 `memory/experiences.json`；`kernels/<name>.c` 保留生成的 opt。
**失败收尾**：跑满 MAX_TRIES 仍未达标 → 将 `kernels/<name>.c` 恢复为备份的原始内容，
`status=failed`，记录 best attempt 的度量，同样导出 result/经验（kind=failure）。

### 关于失败诊断的 LLM 反馈回路
每次闸门失败会生成一段结构化 `feedback`（含编译错误 / mismatches 样本 / 向量化 missed
原因 / 基准数字），可选的 `reflect` 阶段再让 LLM 产出 {root_cause, next_action,
concrete_fixes} 一并拼进下一轮 generate 的"Previous attempts & feedback"，
从而让生成器在历史基础上做小步修正而不是盲改。

### 执行顺序小结（一图流）
```
cli.js ─ config ─ driver.optimize
   │
   ├─[0] workspace/backup/state
   ├─[1] baseline:  compile(_test,diag) → run → orig 指标 + remark(确认 missed)
   ├─[2] analyze:   LLM(analyze.md) → analysis
   └─ attempt 1..N:
        ├─ 经验检索 memory/experienceStore → 生成 LLM(generate.md) → 存 attempt_n.c
        ├─ 写入 kernels/<name>.c(setOpt, 自动截断旧块)
        ├─ 门1 编译(compiler)  ──失败──┐
        ├─ 门2 运行+正确性(compiler)   ├→ feedback(+可选 reflect) → 下一轮
        ├─ 门3 向量化(remarks/VF)      │
        ├─ 门4 性能(benchmark)         │
        └─ 全过? → result/experience/保留opt : 恢复orig/failed
```

---

## 3. 结果产物一览（以 s453 为例）

| 路径 | 内容 |
|------|------|
| `vec-lab/kernels/s453.c` | `s453_orig()` + 标记块内的 `s453_opt()`（成功后保留） |
| `experiments/s453/attempt_1.c` | 该次生成的候选代码快照 |
| `experiments/s453/state.json` | 完整运行状态（含每次闸门结果） |
| `experiments/s453/result.json` | 最终结果：status/metrics/analysis/baseline |
| `experiments/s453/diag_orig.opt.yaml` | orig 的 clang 优化记录（证明 missed） |
| `experiments/s453/kernels_orig.c` | 原始内核备份 |
| `experiments/results.csv` | 全内核性能对比汇总（可喂给 PPT/报告） |
| `memory/experiences.json` | 可复用优化经验（类别/障碍/策略/结果） |

> 重要约定：agent **只写 `kernels/<name>.c`**，从不修改 `vec-lab/entry/*`。
> `entry/<name>_opt.c` 里 `#ifndef HAVE_<K>_OPT` 的占位函数保证"未实现时也能编译"；
> agent 编译 opt 入口时一律带 `-DHAVE_<K>_OPT` 以链接 `kernels/` 里的真实实现。
> 重复运行优化时 `source.setOpt()` 会先删除旧标记块再插入，**同一函数不会出现多份实现**；
> 失败的整轮优化结束后内核文件会被还原，避免留下"未达标"的实现。

---

## 4. 启动命令速查

前置：`npm install` 一次；`clang` 在 PATH（`vec-lab/docs/ENVIRONMENT.md` 有版本信息）。

### 4.1 冒烟验证（10 内核基线）
```powershell
npm run smoke          # 等价 node scripts/smoke.js
```

### 4.2 手动跑单个内核优化
```powershell
node src/cli.js s453                       # 例：优化 s453（已成功 5.67x）
node src/cli.js s1161 --tries 4            # 指定尝试次数
node src/cli.js s212 --threshold 1.1       # 调低速度门槛
node src/cli.js s211 --retain-nogain       # 正确+向量化但加速不足时：留存并标 no-gain
node src/cli.js s341 --force               # 已出结果时强制重跑
node src/cli.js all                        # 依次优化全部 10 内核
```
参数：`--tries N` `--threshold X` `--bench N` `--force` `--retain-nogain`
`--no-reflect` `--quiet`。

退出码：成功/`ok-nogain`=0；失败(达标未满足/出错)=1；参数错=2。

### LLM 模型配置（.env 可覆盖）
默认模型是 **`deepseek-chat`**（非推理型，直接返回正文，快且便宜，适合本管线的多轮循环）。
若在 `.env` 设 `DEEPSEEK_MODEL=deepseek-v4-flash`，请同时把 `LLM_MAX_TOKENS` 提到
**>= 32768**：`deepseek-v4-flash` 是推理型模型，会把大量 token 消耗在 `reasoning_content` 上，
预算不足时接口返回空 `content`（`finish_reason=length`），agent 会重试并对这类情况已有兜底。

### 4.3 手动查看某个内核的实际效果（不跑 agent）
以 s453（opt 已实现）为例，在 `vec-lab/` 下：
```powershell
# 基线(orig)
clang -O3 -march=native -DTYPE=double -I. entry/s453_test.c common.c kernels/s453.c -o s453_test.exe
.\s453_test.exe
# 优化版(需 -DHAVE_S453_OPT)
clang -O3 -march=native -DTYPE=double -I. -DHAVE_S453_OPT entry/s453_opt.c common.c kernels/s453.c -o s453_opt.exe
.\s453_opt.exe
# 循环多次看波动
for ($i=0;$i -lt 5;$i++){ .\s453_opt.exe }
```
stdout 单行 JSON 含 `status/checksum/time/checksum_orig/time_orig/speedup/mismatches`。

### 4.4 查看向量化证据（clang remark）
```powershell
clang -O3 -march=native -DTYPE=double -I. -DHAVE_S453_OPT `
  -fsave-optimization-record -foptimization-record-file=s453.opt.yaml `
  -Rpass=loop-vectorize -Rpass-missed=loop-vectorize -Rpass-analysis=loop-vectorize `
  entry/s453_opt.c common.c kernels/s453.c -o s453_opt.exe
```

---

## 5. 关于"难优化的内核"的处理建议

- 运行结束退出码为 1 且 `result.json` 中 `status=failed`，不代表完全失败：
  打开 `experiments/<kernel>/state.json` 看各 attempt 走到哪一闸门。
- 若某内核已 **correct + vectorized**、只是 speedup 未达 1.15（如 s211 约 0.95x，
  原版可能已被 unroll+SLP 逼近最优，cache 驻留），可用 `--threshold 1.0` 让该内核
  以"正确+向量化"作为达标结果留存，后续再讨论策略。
- 常见高收益方向（可优先手动试）：s453(已完成)、s1161(if-conversion)、s212、
  s241、s292；常见难收益/结构性强的：s211、s341、s421、s482、vdotr。

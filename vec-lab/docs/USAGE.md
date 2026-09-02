# 使用说明

如何编译、运行 vec-lab 的测试入口，以及如何通过 node 程序或 clang 诊断获取结果。

所有命令在 `vec-lab` 目录下执行。`clang` 须在 PATH 中。

## 编译与运行

### 基线入口（orig 一定存在）

```powershell
clang -O3 -march=native -DTYPE=double -I. entry/s1161_test.c common.c kernels/s1161.c -o s1161_test.exe
.\s1161_test.exe
```

### 优化入口（opt 未实现时为占位，输出 not_implemented）

```powershell
clang -O3 -march=native -DTYPE=double -I. entry/s1161_opt.c common.c kernels/s1161.c -o s1161_opt.exe
.\s1161_opt.exe
```

opt 实现后追加 `-DHAVE_<大写N>_OPT`（如 s1161 → `HAVE_S1161_OPT`）启用真实版本。

每条命令**仅编译目标内核**（entry + common.c + kernels/\<n\>.c）。
类型默认 double，可换 `-DTYPE=float`。

## JSON 输出格式

入口程序在 **stdout 输出恰好一行 JSON**（警告/诊断在 stderr，不污染 stdout）。

**`<n>_test.exe`（orig 基线）**

```json
{"kernel":"s1161","mode":"orig","status":"ok","checksum":45464.74365186564,"time":0.052000}
```

**`<n>_opt.exe`（opt 未实现，占位）**

```json
{"kernel":"s1161","mode":"opt","status":"not_implemented","checksum":0,"time":0,"checksum_orig":45464.74365186564,"time_orig":0.051000,"speedup":0,"mismatches":-1}
```

**`<n>_opt.exe`（opt 已实现）**

```json
{"kernel":"s1161","mode":"opt","status":"ok","checksum":45464.74365186564,"time":0.012000,"checksum_orig":45464.74365186564,"time_orig":0.051000,"speedup":4.2500,"mismatches":0}
```

| 字段 | 含义 |
|------|------|
| `status` | `ok` / `not_implemented` / `error` |
| `checksum` | 正确性指标：六数组元素和 + 归约结果 lab_result |
| `time` | 性能指标：内核耗时（秒，clock() CPU 时间） |
| `checksum_orig` / `time_orig` | 同进程内先跑的 orig 参考 |
| `speedup` | time_orig / time，未实现或出错时为 0 |
| `mismatches` | 容差比对不一致元素个数，0=通过；-1=未比对 |

**退出码**：`_test` → 0=ok, 1=error；`_opt` → 0=ok 且 checksum 一致, 1=不一致或 error, 2=not_implemented（占位，属预期）。

## 向量化诊断

### 方式一：终端输出（-Rpass\*）

```powershell
clang -O3 -march=native -DTYPE=double -I. `
      -Rpass=loop-vectorize -Rpass-missed=loop-vectorize -Rpass-analysis=loop-vectorize `
      entry/s1161_opt.c common.c kernels/s1161.c -o s1161_opt.exe
```

remark 走 **stderr**，按 `kernels/<n>.c` 路径过滤内核自身（`common.c` 的 remark 会混入）。

### 方式二：持久化到 YAML 文件（-fsave-optimization-record）

```powershell
clang -O3 -march=native -DTYPE=double -I. `
      -fsave-optimization-record `
      -Rpass=loop-vectorize -Rpass-missed=loop-vectorize -Rpass-analysis=loop-vectorize `
      entry/s1161_opt.c common.c kernels/s1161.c -o s1161_opt.exe
```

默认生成 `s1161_opt.opt.yaml`（与输出 exe 同名，扩展名 `.opt.yaml`）。
也可用 `-foptimization-record-file=<path>` 指定路径。

**YAML 比终端 stderr 信息更详细**，包含：

| 记录类型 | 内容 |
|---------|------|
| `!Passed` (loop-vectorize) | 向量化成功：宽度 (VectorizationFactor)、交错度 (InterleaveCount) |
| `!Missed` (loop-vectorize) | 向量化失败：具体原因（反依赖、不可归约、cost-model 不划算等） |
| `!Analysis` (loop-vectorize) | 深层分析：如 NonReductionValueUsedOutsideLoop |
| `!Missed` (regalloc) | 寄存器压力：虚拟寄存器拷贝数、总拷贝代价 |
| `!Analysis` (prolog-epilog) | 栈大小 (NumStackBytes) |
| `!Analysis` (asm-printer) | 指令混合 (InstructionMix)：每基本块的指令种类与计数 |
| `!Analysis` (asm-printer) | 指令总数 (InstructionCount) |

每条记录带 `DebugLoc`（文件:行:列）和 `Function`，可精确关联到源码位置。

**用途**：这是让 LLM 进行向量化优化的重要原料——它能看到 clang 为什么拒绝向量化、
生成了哪些指令、寄存器/栈压力如何，从而有针对性地设计变换策略。

### node 程序获取诊断示例

```js
const { spawnSync } = require("child_process");
const flags = ["-O3", "-march=native", "-DTYPE=double", "-I."];
const diag = ["-fsave-optimization-record",
              "-Rpass=loop-vectorize", "-Rpass-missed=loop-vectorize", "-Rpass-analysis=loop-vectorize"];

// 编译 + 诊断 yaml
const c = spawnSync("clang",
  [...flags, ...diag, `entry/${n}_opt.c`, "common.c", `kernels/${n}.c`, "-o", `${n}_opt.exe`],
  { cwd: "vec-lab", encoding: "utf8" });
// c.stderr 含终端格式的 remark (可选)
// ${n}_opt.opt.yaml 含结构化诊断 (主要原料)

// 运行并解析单行 JSON
const r = spawnSync(`${n}_opt.exe`, [], { cwd: "vec-lab", encoding: "utf8" });
const result = JSON.parse(r.stdout.trim());
```

## node 程序交互约定

```js
const { spawnSync } = require("child_process");
const flags = ["-O3", "-march=native", "-DTYPE=double", "-I."];

// 编译 (仅目标内核); opt 实现后追加 -DHAVE_<大写N>_OPT, 如 s1161 -> HAVE_S1161_OPT
spawnSync("clang", [...flags, `entry/${n}_test.c`, "common.c", `kernels/${n}.c`, "-o", `${n}_test.exe`], { cwd: "vec-lab" });
spawnSync("clang", [...flags, "-DHAVE_S1161_OPT", `entry/${n}_opt.c`, "common.c", `kernels/${n}.c`, "-o", `${n}_opt.exe`], { cwd: "vec-lab" });

// 运行并解析单行 JSON
const r = spawnSync(`${n}_opt.exe`, [], { cwd: "vec-lab", encoding: "utf8" });
const result = JSON.parse(r.stdout.trim());   // {status, checksum, time, speedup, mismatches, ...}
```

## 注意事项

1. **opt 占位机制**：`entry/<n>_opt.c` 内 `#ifndef HAVE_<大写N>_OPT` 提供占位（返回 1 = 未实现）。
   在 `kernels/<n>.c` 添加 `<n>_opt()` 后，编译 opt 入口必须加 `-DHAVE_<大写N>_OPT`，否则占位重复符号链接报错；
2. **opt 返回码约定**：0=成功, 1=占位（未实现）, 其他非 0=运行出错；
3. **数据确定性**：orig 与 opt 都从 `lab_init_data(42u)` 开始，输入完全相同，checksum 可直接比对；
   opt 入口在跑 opt 前会重新初始化数据，两轮互不污染；
4. **数据特化与容差**：`lab_prepare("s482")` 抬高 `b` 使 break 不触发、循环跑满全长（所有入口统一调用，其余内核为空操作）；
   容差全部位精确（tol=0），仅 vdotr 因 FP 归约重结合用 1e-9(double)/1e-5(float)，按 `sizeof(TYPE)` 自动选择；
5. **计时波动与 cache 偏差**：`time` 为 clock() CPU 时间，单次运行有波动。
   `_opt.c` 内先跑 orig 再跑 opt，opt 受益于 orig 预热后的 warm cache/branch predictor，
   **speedup 为系统性乐观估计**（对智能体决策是安全偏差，宁高估不漏判）。
   node 程序宜多次运行 `_opt.exe`（如 5 次）取 `time_orig`/`time_opt` 各自的最小值或中位数再算 speedup；
6. `-march=native` 依赖本机，exe 不可跨机器分发，换机器需重新编译；
7. `*.exe` 与 `*.opt.yaml` 均为编译产物，可随时删除重建。

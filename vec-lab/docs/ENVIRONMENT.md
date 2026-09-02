# 实验环境

本文件记录 vec-lab 的运行环境与选定的 10 个目标函数信息，供结果复现与后续参考。

## 系统信息

| 项 | 值 |
|----|-----|
| 操作系统 | Windows 11 (10.0.22000) |
| CPU | AMD Ryzen 7 5800H with Radeon Graphics |
| 核心数 | 8 物理核 / 16 逻辑线程 |
| 时区 | Asia/Shanghai |

## 编译器信息

| 项 | 值 |
|----|-----|
| clang 版本 | 23.1.0 |
| Target | x86_64-pc-windows-msvc |
| Thread model | posix |
| 构建配置 | +alloc:rpmalloc |
| 安装路径 | D:\ruanjian\vscode\llvm\bin |
| 源码 commit | ea7d852a70e8bdfaf601d6626a760f9771b2c4b4 (llvm-project) |

### 编译选项

```
clang -O3 -march=native -DTYPE=double -I.
```

- `-O3`：最高优化级别
- `-march=native`：启用本机所有 SIMD 指令集（AVX2 + FMA on Ryzen 5800H）
- `-DTYPE=double`：双精度浮点（可换 `-DTYPE=float`）
- `-I.`：头文件搜索路径为 vec-lab 目录

### Windows 兼容性要点

- clang (MSVC target) + UCRT：需 `-D_CRT_DECLARE_NONSTDC_NAMES=0` 防止 min/max 宏冲突
  （vec-lab 已内置于 common.h，无需手动添加）
- vec-lab 不使用 posix_memalign，无需 compat.c shim（TSVC 原版需要）

## TSVC 版本信息

| 项 | 值 |
|----|-----|
| 来源 | [llvm-test-suite](https://github.com/llvm/llvm-test-suite) 中的 TSVC 目录 |
| 原始论文 | Maleki, S., et al. *An Evaluation of Vectorizing Compilers*. PACT'11. 10.1109/PACT.2011.68 |
| 原始源码 | http://polaris.cs.uiuc.edu/~maleki1/TSVC.tar.gz |
| 本地路径 | `D:\code_cpp\vectorizer_agent\TSVC\` |

TSVC 原版用 `struct GlobalData` + `TYPE *const a` 指针访问全局数组，别名分析失败导致
部分函数被误判为不可向量化。vec-lab 改用直连全局数组消除此障碍，基线诊断更准确。

## 选定的 10 个目标函数

均在 vec-lab 布局下经 `-O3 -march=native` 验证为 clang 无法自动向量化（missed）。

| 函数 | TSVC 类别 | 向量化障碍 | 优化方向 |
|------|-----------|-----------|----------|
| s1161 | ControlFlow | if/goto 互斥分支 | 结构化 if/else (if-conversion) |
| s211 | StatementReordering | 真依赖 + 反依赖对 | 依赖代入 + 平移拷贝 |
| s212 | StatementReordering | 反依赖（读 a[i+1] 旧值） | 循环拆分 |
| s241 | NodeSplitting | 相邻跨迭代真依赖 | 数组展开 + 拆分 |
| s292 | LoopRestructuring | wrap-around 标量 im1/im2 | 循环剥离 |
| s341 | Packing | 写位置依赖前缀计数 | 谓词 + 分块前缀和 + 散射写 |
| s421 | Equivalencing | yy/xx 指针别名反依赖 | 向量化平移拷贝 |
| s453 | InductionVariable | 浮点归纳变量 s+=2. | 解析式 2*(i+1) |
| s482 | ControlFlow | break 提前退出 | SIMD 扫描退出点 + 向量化计算 |
| vdotr | ControlLoops | FP 归约禁止重结合 | AVX2 FMA 手动 SIMD（容差比对） |

### 数据规模

| 参数 | 值 | 说明 |
|------|-----|------|
| LEN | 32000 | 一维数组长度 (a..e, xx_buf) |
| LEN2 | 256 | 二维数组维度 (aa, bb, cc) |
| NTIMES | 2325 | 默认迭代次数（可覆盖） |
| TYPE | double (默认) | 可换 float |

### 数据初始化

`lab_init_data(42u)` 用 LCG 确定性填充：
```c
TYPE seed = (TYPE)seed_in;
for (int i = 0; i < LEN; i++) {
    seed = (seed * (TYPE)16807) % (TYPE)2147483647;
    a[i] = seed / (TYPE)2147483647;  // 映射到 [0,1)
    // b, c, d, e 同理, 各自递推
}
```
种子固定 42，保证 orig 与 opt 输入完全一致，checksum 可直接比对。

### 基线验证结果

10 个内核的 `_orig()` 在 `-O3 -march=native` 下均被 clang 诊断为 missed（不可自动向量化）。
诊断依据：TSVC 目录下的 `lv-all-dbl.txt.summary` 与 `lv-native-dbl.txt.summary`，
并经 vec-lab 布局交叉验证（s276 因 vec-lab 直连数组后被自动向量化，已用 s212 替换）。

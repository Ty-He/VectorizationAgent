# 架构设计

vec-lab 的代码组织与运行机制。供后续开发者和优化 agent 理解框架设计。

## 分层结构

```
common.h / common.c          公共框架层 (数据、计时、比对、JSON 报告)
kernels/<name>.c             内核层 (orig 基线 + opt 待实现)
entry/<name>_test.c          基线入口 (只跑 orig)
entry/<name>_opt.c           优化入口 (orig 参考 + opt + 比对)
```

编译时每个入口**仅链接一个内核**：`entry/<n>_*.c + common.c + kernels/<n>.c`。
这样 clang 的优化诊断只涉及目标内核，不会被其他内核干扰。

## 公共框架层 (common.h / common.c)

### 全局数据

```c
TYPE a[LEN], b[LEN], c[LEN], d[LEN], e[LEN];   // LEN=32000
TYPE aa[LEN2][LEN2], bb[LEN2][LEN2], cc[LEN2][LEN2];  // LEN2=256, 二维
TYPE xx_buf[LEN], *xx, *yy;                      // xx/yy 指向 xx_buf (s421 用)
TYPE lab_result;                                  // 归约结果 (vdotr 等)
```

TSVC 原版用 `struct GlobalData` + `TYPE *const a` 指针访问，别名分析失败导致部分函数
被误判为不可向量化。vec-lab 改用直连全局数组，消除指针别名障碍，基线诊断更准确。

### 确定性初始化

`lab_init_data(seed)` 用 LCG（线性同余生成器）确定性填充所有数组，种子固定 42。
orig 与 opt 从相同输入出发，checksum 可直接比对。`lab_init_data` 同时复位 `xx`/`yy`
指向 `xx_buf`（s421 用 yy/xx 指针别名制造反依赖）。

### 数据特化

`lab_prepare(kernel)` 在初始化之后、内核运行之前调用，做内核专属的数据调整：
- **s482**：抬高 `b`（`b[i] += 2.1`），使循环条件 `c[i] > b[i]` 恒不成立，
  break 不触发，循环跑满全长（否则提前退出，无优化意义）。
- 其余内核为空操作，但所有入口统一调用，保持模板一致。

### 快照与容差比对

```c
void lab_snapshot(void);   // 保存当前 a..e/xx_buf/yy 指向内容到内部副本
int  lab_compare(TYPE tol); // 逐元素比对快照与当前数据, 返回不一致个数
```

`_opt.c` 的流程：跑 orig → `lab_snapshot()` 保存 orig 结果 → 重新初始化 → 跑 opt →
`lab_compare(tol)` 逐元素检查 opt 是否复现 orig 的输出。

### 计时

`lab_now()` 返回 `clock()` 的秒数（CPU 时间）。单次测量有波动且分辨率有限（Windows 约 1ms），
上层程序宜多次运行取统计值。

### 防删除桩

`common.c` 中的 `noinline` dummy 函数防止 `-O3` 删除"看似无用"的循环（如只写不读的数组）。

## 内核层 (kernels/\<name\>.c)

每个内核文件包含：
- `<name>_orig()`：忠实于 TSVC `tsc.inc` 的原始实现，不可被 clang 自动向量化
- `<name>_opt()`：**TODO，由优化 agent 实现**。实现前为占位（见下）

文件头部注释记录了该内核的向量化障碍与优化方向（详见 [ENVIRONMENT.md](ENVIRONMENT.md)）。

## 入口层 (entry/)

### 基线入口 `<name>_test.c`

```c
int main(void) {
  lab_init_data(42u);
  lab_prepare("<name>");
  double t0 = lab_now();
  int rc = <name>_orig();
  double dt = lab_now() - t0;
  return lab_report_orig("<name>", rc, dt);
}
```

只跑 orig，输出 `{"mode":"orig",...}`。退出码 0=ok / 1=error。

### 优化入口 `<name>_opt.c`

```c
int main(void) {
  // 1) orig 作参考
  lab_init_data(42u); lab_prepare("<name>");
  double t0 = lab_now(); int rc_orig = <name>_orig(); double t_orig = lab_now() - t0;
  TYPE cs_orig = lab_checksum(); lab_snapshot();

  // 2) 相同输入跑 opt
  lab_init_data(42u); lab_prepare("<name>");
  double t1 = lab_now(); int rc_opt = <name>_opt(); double t_opt = lab_now() - t1;

  // 3) 容差比对 + JSON 报告
  return lab_report_opt("<name>", rc_orig, rc_opt, t_opt, cs_orig, t_orig, tol);
}
```

同进程内先跑 orig（作参考 + 快照），再跑 opt（容差比对），输出 `{"mode":"opt",...}`。

**cache 偏差**：opt 受益于 orig 预热后的 warm cache/branch predictor，speedup 为系统性
乐观估计。这对智能体决策是安全偏差（宁高估不漏判）。消除方法：上层多次运行取统计值。

### 占位机制

opt 入口内：
```c
#ifndef HAVE_<大写N>_OPT
int <name>_opt(void) { return 1; }   // 占位: 返回 1 = 未实现
#endif
```

agent 在 `kernels/<n>.c` 实现 `<name>_opt()` 后，编译 opt 入口须加 `-DHAVE_<大写N>_OPT`
（否则占位与真实实现重复符号，链接报错）。

### 返回码约定

| 函数返回值 | 含义 |
|-----------|------|
| 0 | 成功 |
| 1 | 占位（未实现） |
| 其他非 0 | 运行出错 |

`lab_report_opt` 据此区分 `not_implemented`（rc_opt==1）与 `error`（rc_opt 非 0/1）。

## 容差约定

| 内核 | 容差 | 原因 |
|------|------|------|
| 除 vdotr 外全部 | 0（位精确） | 优化不应改变数值结果 |
| vdotr | 1e-9 (double) / 1e-5 (float) | FP 归约重结合（AVX FMA）允许误差 |

容差在 `entry/<n>_opt.c` 的 `lab_report_opt` 调用处指定，vdotr 按 `sizeof(TYPE)` 自动选择。

// s482 -- 来源: TSVC (ControlFlow)
//
// 向量化障碍: 循环内 break (数据相关的提前退出) 阻止向量化,
//             向量化器报告 "loop not vectorized"。
// 优化方向:   "扫描 + 计算" 两遍变换:
//             1) SIMD (比较 + movemask) 找首个 c[i] > b[i] 的下标 k;
//             2) 原循环"先加后判", 对 [0, k] 向量化执行 a[i] += b[i]*c[i]。
//
// TODO: 在本文件中添加 s482_opt() —— 人工变换后的可向量化版本。
#include "common.h"

int s482_orig(void)
{
  for (int nl = 0; nl < NTIMES; nl++) {
    for (int i = 0; i < LEN; i++) {
      a[i] += b[i] * c[i];
      if (c[i] > b[i]) break;
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}

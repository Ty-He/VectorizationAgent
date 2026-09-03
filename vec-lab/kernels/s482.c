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


/* ====BEGIN_OPT_AUTOGEN (vectorizer agent)==== */
#include <immintrin.h>

int s482_opt(void)
{
  for (int nl = 0; nl < NTIMES; nl++) {
    int k = LEN;
    for (int i = 0; i < LEN; i += 4) {
      __m256d cb = _mm256_loadu_pd(&c[i]);
      __m256d bb = _mm256_loadu_pd(&b[i]);
      __m256d mask = _mm256_cmp_pd(cb, bb, _CMP_GT_OQ);
      int m = _mm256_movemask_pd(mask);
      if (m) {
        int idx = __builtin_ctz(m);
        k = i + idx;
        break;
      }
    }
    if (k == LEN) {
      for (int i = 0; i < LEN; i++) {
        a[i] += b[i] * c[i];
      }
    } else {
      for (int i = 0; i <= k; i++) {
        a[i] += b[i] * c[i];
      }
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}
/* ====END_OPT_AUTOGEN==== */

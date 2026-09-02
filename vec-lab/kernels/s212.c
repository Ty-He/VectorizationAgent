// s212 -- 来源: TSVC (StatementReordering)
//
// 向量化障碍:
//   a[i] *= c[i];
//   b[i] += a[i+1] * d[i];   读 a[i+1] 的旧值 (对 a[i+1] 的写在下一迭代)
//   存在跨迭代反依赖 (WAR), 向量化器无法证明写后读安全,
//   报告 "loop not vectorized"。
// 优化方向:   循环拆分 (fission)。先向量化执行 b 的更新 (此时 a[] 全为旧值),
//             再向量化执行 a 的更新, 反依赖即被消除。
//
// TODO: 在本文件中添加 s212_opt() —— 人工变换后的可向量化版本。
#include "common.h"

int s212_orig(void)
{
  for (int nl = 0; nl < NTIMES; nl++) {
    for (int i = 0; i < LEN - 1; i++) {
      a[i] *= c[i];
      b[i] += a[i + 1] * d[i];
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}


/* ====BEGIN_OPT_AUTOGEN (vectorizer agent)==== */
int s212_opt(void)
{
  for (int nl = 0; nl < NTIMES; nl++) {
    for (int i = 0; i < LEN - 1; i++) {
      double old_a_next = a[i + 1];
      double old_a = a[i];
      b[i] += old_a_next * d[i];
      a[i] = old_a * c[i];
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}
/* ====END_OPT_AUTOGEN==== */

// s241 -- 来源: TSVC (NodeSplitting)
//
// 向量化障碍:
//   a[i] = b[i] * c[i] * d[i];
//   b[i] = a[i] * a[i+1] * d[i];
//   b[i] 读 a[i] (本迭代刚写的新值) 和 a[i+1] (旧值), 形成相邻跨迭代
//   真依赖, 向量化器报告 "loop not vectorized"。
// 优化方向:   数组展开 (备份 a 旧值) + 循环拆分, 使 a/b 更新各自独立向量化。
//
// TODO: 在本文件中添加 s241_opt() —— 人工变换后的可向量化版本。
#include "common.h"

int s241_orig(void)
{
  for (int nl = 0; nl < 2 * NTIMES; nl++) {
    for (int i = 0; i < LEN - 1; i++) {
      a[i] = b[i] * c[i] * d[i];
      b[i] = a[i] * a[i + 1] * d[i];
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}


/* ====BEGIN_OPT_AUTOGEN (vectorizer agent)==== */
int s241_opt(void)
{
  for (int nl = 0; nl < 2 * NTIMES; nl++) {
    for (int i = 0; i < LEN - 1; i++) {
      double bi = b[i];
      double ci = c[i];
      double di = d[i];
      double ai = bi * ci * di;
      double an = a[i + 1];
      a[i] = ai;
      b[i] = ai * an * di;
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}
/* ====END_OPT_AUTOGEN==== */

// s1161 -- 来源: TSVC (ControlFlow)
//
// 向量化障碍: if/goto 构成互斥分支区域, 编译器难以自动完成 if-conversion,
//             向量化器报告 "loop not vectorized"。
// 优化方向:   goto -> 结构化 if/else (两个分支写不同数组且互斥, 无跨迭代依赖)。
//
// TODO: 在本文件中添加 s1161_opt() —— 人工变换后的可向量化版本。
#include "common.h"

int s1161_orig(void)
{
  for (int nl = 0; nl < NTIMES; nl++) {
    for (int i = 0; i < LEN - 1; ++i) {
      if (c[i] < (TYPE)0.) {
        goto L20;
      }
      a[i] = c[i] + d[i] * e[i];
      goto L10;
L20:
      b[i] = a[i] + d[i] * d[i];
L10:
      ;
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}


/* ====BEGIN_OPT_AUTOGEN (vectorizer agent)==== */
int s1161_opt(void)
{
  for (int nl = 0; nl < NTIMES; nl++) {
    for (int i = 0; i < LEN - 1; ++i) {
      TYPE ai = a[i];
      TYPE ci = c[i];
      TYPE di = d[i];
      if (ci < (TYPE)0.) {
        b[i] = ai + di * di;
      } else {
        a[i] = ci + di * e[i];
      }
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}
/* ====END_OPT_AUTOGEN==== */

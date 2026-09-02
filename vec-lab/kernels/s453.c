// s453 -- 来源: TSVC (InductionVariable)
//
// 向量化障碍: s 是浮点归纳变量 (s += 2.)。浮点归纳变量不能自动转换为
//             解析式 (浮点无重结合保证), 循环携带标量依赖阻止向量化,
//             向量化器报告 "loop not vectorized"。
// 优化方向:   逆强度削减。s 的值恰为 2*(i+1) (可精确表示的整数),
//             直接写成解析式 a[i] = (TYPE)(2*(i+1)) * b[i], 归纳变量消失。
//
// TODO: 在本文件中添加 s453_opt() —— 人工变换后的可向量化版本。
#include "common.h"

int s453_orig(void)
{
  TYPE s;
  for (int nl = 0; nl < 2 * NTIMES; nl++) {
    s = 0.;
    for (int i = 0; i < LEN; i++) {
      s += (TYPE)2.;
      a[i] = s * b[i];
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}


/* ====BEGIN_OPT_AUTOGEN (vectorizer agent)==== */
int s453_opt(void)
{
  for (int nl = 0; nl < 2 * NTIMES; nl++) {
    for (int i = 0; i < LEN; i++) {
      a[i] = (TYPE)(2 * (i + 1)) * b[i];
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}
/* ====END_OPT_AUTOGEN==== */

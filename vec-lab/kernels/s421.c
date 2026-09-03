// s421 -- 来源: TSVC (Equivalencing)
//
// 向量化障碍: yy = xx 使两指针指向同一数组 (别名 / equivalence),
//             xx[i] = yy[i+1] + a[i] 存在反依赖 (读旧 xx[i+1], 写 xx[i]),
//             编译器别名分析无法证明无冲突, 报告 "loop not vectorized"。
// 优化方向:   向量化平移拷贝。先把旧值 xx[i+1] 拷到临时缓冲,
//             更新循环即与自身反依赖解耦。
//
// TODO: 在本文件中添加 s421_opt() —— 人工变换后的可向量化版本。
#include "common.h"

int s421_orig(void)
{
  for (int nl = 0; nl < 4 * NTIMES; nl++) {
    yy = xx;
    for (int i = 0; i < LEN - 1; i++) {
      xx[i] = yy[i + 1] + a[i];
    }
    dummy(a, b, c, d, e, aa, bb, cc, 1.);
  }
  return 0;
}


/* ====BEGIN_OPT_AUTOGEN (vectorizer agent)==== */
int s421_opt(void)
{
  static TYPE temp[LEN];
  for (int nl = 0; nl < 4 * NTIMES; nl++) {
    yy = xx;
    TYPE * __restrict xp = xx;
    TYPE * __restrict ap = a;
    TYPE * __restrict tp = temp;
    for (int i = 0; i < LEN - 1; i++) {
      tp[i] = xp[i + 1];
    }
    #pragma clang loop vectorize(enable)
    for (int i = 0; i < LEN - 1; i++) {
      xp[i] = tp[i] + ap[i];
    }
    dummy(a, b, c, d, e, aa, bb, cc, 1.);
  }
  return 0;
}
/* ====END_OPT_AUTOGEN==== */

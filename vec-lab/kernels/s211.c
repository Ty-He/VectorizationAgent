// s211 -- 来源: TSVC (StatementReordering)
//
// 向量化障碍: 两条语句形成跨迭代依赖对:
//   S1: a[i] = b[i-1] + ...   读 b[i-1], 是上一迭代 S2 刚写入的新值 (真依赖)
//   S2: b[i] = b[i+1] - ...   读 b[i+1], 是尚未被写的旧值       (反依赖)
//   向量化器报告 "loop not vectorized"。
// 优化方向:   依赖代入 (b[i-1] = b[i] - e[i-1]*d[i-1], 此刻 b[i] 仍是旧值)
//             解耦 a 的更新; b 的更新用平移拷贝到临时数组消除反依赖。
//
// TODO: 在本文件中添加 s211_opt() —— 人工变换后的可向量化版本。
#include "common.h"

int s211_orig(void)
{
  for (int nl = 0; nl < NTIMES; nl++) {
    for (int i = 1; i < LEN - 1; i++) {
      a[i] = b[i - 1] + c[i] * d[i];
      b[i] = b[i + 1] - e[i] * d[i];
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}


/* ====BEGIN_OPT_AUTOGEN (vectorizer agent)==== */
int s211_opt(void)
{
  for (int nl = 0; nl < NTIMES; nl++) {
    double prev_b = b[0];
    for (int i = 1; i < LEN - 1; i++) {
      double b_next = b[i + 1];
      double b_cur = b_next - e[i] * d[i];
      a[i] = prev_b + c[i] * d[i];
      b[i] = b_cur;
      prev_b = b_cur;
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}
/* ====END_OPT_AUTOGEN==== */

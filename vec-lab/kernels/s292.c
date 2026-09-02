// s292 -- 来源: TSVC (LoopRestructuring)
//
// 向量化障碍: im1/im2 是 wrap-around 归纳变量 (初值 LEN-1/LEN-2, 每次迭代
//             滚动), 形成环状标量依赖, 向量化器报告 "loop not vectorized"。
// 优化方向:   循环剥离。手工展开前两次迭代后 im1/im2 恰为 i-1 与 i-2,
//             剩余部分变成固定相对索引 b[i-1], b[i-2], 可直接向量化。
//
// TODO: 在本文件中添加 s292_opt() —— 人工变换后的可向量化版本。
#include "common.h"

int s292_orig(void)
{
  int im1, im2;
  for (int nl = 0; nl < NTIMES; nl++) {
    im1 = LEN - 1;
    im2 = LEN - 2;
    for (int i = 0; i < LEN; i++) {
      a[i] = (b[i] + b[im1] + b[im2]) * (TYPE).333;
      im2 = im1;
      im1 = i;
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}


/* ====BEGIN_OPT_AUTOGEN (vectorizer agent)==== */
int s292_opt(void)
{
  for (int nl = 0; nl < NTIMES; nl++) {
    a[0] = (b[0] + b[LEN - 1] + b[LEN - 2]) * (TYPE).333;
    a[1] = (b[1] + b[0] + b[LEN - 1]) * (TYPE).333;
    for (int i = 2; i < LEN; i++) {
      a[i] = (b[i] + b[i - 1] + b[i - 2]) * (TYPE).333;
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}
/* ====END_OPT_AUTOGEN==== */

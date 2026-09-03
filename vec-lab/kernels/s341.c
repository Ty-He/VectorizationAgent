// s341 -- 来源: TSVC (Packing)
//
// 向量化障碍: 压缩 (pack): 写位置 j 依赖之前所有迭代中 b[k]>0 的个数,
//             循环携带的串行依赖链, 向量化器报告 "loop not vectorized"。
// 优化方向:   两遍变换: 1) 向量化生成谓词; 2) 分块前缀和得到目标下标;
//             3) 条件散射写 (目标位置互不相同, 无写冲突)。
//
// TODO: 在本文件中添加 s341_opt() —— 人工变换后的可向量化版本。
#include "common.h"

int s341_orig(void)
{
  int j;
  for (int nl = 0; nl < NTIMES; nl++) {
    j = -1;
    for (int i = 0; i < LEN; i++) {
      if (b[i] > (TYPE)0.) {
        j++;
        a[j] = b[i];
      }
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}


/* ====BEGIN_OPT_AUTOGEN (vectorizer agent)==== */
#include <immintrin.h>
int s341_opt(void)
{
  static int idx[LEN];
  for (int nl = 0; nl < NTIMES; nl++) {
    int count = 0;
    for (int i = 0; i < LEN; i++) {
      if (b[i] > (TYPE)0.) {
        idx[count++] = i;
      }
    }
    int j = 0;
    for (; j + 4 <= count; j += 4) {
      __m128i idxv = _mm_loadu_si128((const __m128i*)&idx[j]);
      __m256d bv = _mm256_set_pd(b[idx[j+3]], b[idx[j+2]], b[idx[j+1]], b[idx[j]]);
      _mm256_storeu_pd(&a[j], bv);
    }
    for (; j < count; j++) {
      a[j] = b[idx[j]];
    }
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}
/* ====END_OPT_AUTOGEN==== */

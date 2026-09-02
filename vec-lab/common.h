#ifndef VEC_LAB_COMMON_H
#define VEC_LAB_COMMON_H
//
// vec-lab -- 从 TSVC 中挑选的 10 个“编译器无法自动向量化”内核的独立实验场。
//
// 每个内核文件 (kernels/*.c) 提供两个版本:
//   <name>_orig  原始实现（忠实于 TSVC tsc.inc, 不可自动向量化）
//   <name>_opt   人工变换后的实现（可向量化 / SIMD）
// entry/ 下的单函数入口对两者使用相同输入数据, 比对结果并计时,
// 编译与调用约定见 README.md。
//
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifndef LEN
#define LEN 32000            /* 与 TSVC types.h 一致, 须为 40 的倍数 */
#endif
#define LEN2 256

#ifndef TYPE
#define TYPE float           /* 默认单精度; 双精度用 -DTYPE=double */
#define FABS(x) fabsf(x)
#else
#define FABS(x) fabs(x)
#endif

#ifndef NTIMES
#define NTIMES 2325          /* 与 run.ps1 默认一致, 可用 -DNTIMES=... 覆盖 */
#endif

extern TYPE a[LEN], b[LEN], c[LEN], d[LEN], e[LEN];
extern TYPE aa[LEN2][LEN2], bb[LEN2][LEN2], cc[LEN2][LEN2];
extern TYPE xx_buf[LEN];
extern TYPE *xx, *yy;        /* s421: 别名指针 (xx 指向 xx_buf) */
extern TYPE lab_result;      /* 归约类内核的标量结果 */

/* TSVC 同款哑函数: noinline, 防止编译器把内核循环优化删除 */
int dummy(TYPE a1[LEN], TYPE b1[LEN], TYPE c1[LEN], TYPE d1[LEN], TYPE e1[LEN],
          TYPE aa1[LEN2][LEN2], TYPE bb1[LEN2][LEN2], TYPE cc1[LEN2][LEN2], TYPE s);

void   lab_init_data(unsigned seed); /* 确定性重置全部数据 */
void   lab_snapshot(void);           /* 保存参考结果 (a..e, xx_buf, lab_result) */
int    lab_compare(TYPE tol);        /* 逐元素比对, 返回不一致元素个数 */
double lab_now(void);                /* 计时, 秒 */

/* ---- 面向 node 程序的入口框架 (entry 目录的入口文件使用, 输出单行 JSON) ---- */
TYPE   lab_checksum(void);           /* 正确性指标: 六数组之和 + lab_result */
void   lab_prepare(const char *kernel); /* 内核数据特化 (目前仅 s482) */
/* orig 基线入口: 打印 {"kernel","mode":"orig","status","checksum","time"} */
int    lab_report_orig(const char *kernel, int rc, double t);
/* opt 入口: orig 作参考 + 跑 opt + 容差比对,
   打印 {"kernel","mode":"opt","status","checksum","time","checksum_orig",
         "time_orig","speedup","mismatches"}
   约定: opt 函数返回 0=成功, 1=占位(未实现), 其他非 0=运行出错。
   返回码: 0=ok且比对一致, 1=不一致或error, 2=not_implemented */
int    lab_report_opt(const char *kernel, int rc_orig, int rc_opt,
                      double t_opt, TYPE cs_orig, double t_orig, TYPE tol);

#endif // VEC_LAB_COMMON_H

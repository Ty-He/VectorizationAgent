#include "common.h"

TYPE a[LEN], b[LEN], c[LEN], d[LEN], e[LEN];
TYPE aa[LEN2][LEN2], bb[LEN2][LEN2], cc[LEN2][LEN2];
TYPE xx_buf[LEN];
TYPE *xx = xx_buf, *yy = xx_buf;
TYPE lab_result;

int dummy(TYPE a1[LEN], TYPE b1[LEN], TYPE c1[LEN], TYPE d1[LEN], TYPE e1[LEN],
          TYPE aa1[LEN2][LEN2], TYPE bb1[LEN2][LEN2], TYPE cc1[LEN2][LEN2], TYPE s)
{
  return (int)(a1[0] + b1[0] + c1[0] + d1[0] + e1[0] +
               aa1[0][0] + bb1[0][0] + cc1[0][0] + s);
}

/* ---- 确定性数据初始化 (LCG), orig 与 opt 使用相同输入 ---- */
static unsigned lab_rng;

static double lab_frand(void)   /* [0,1) */
{
  lab_rng = lab_rng * 1664525u + 1013904223u;
  return (double)(lab_rng >> 8) / 16777216.0;
}

void lab_init_data(unsigned seed)
{
  lab_rng = seed ? seed : 1u;
  for (int i = 0; i < LEN; i++) {
    a[i] = (TYPE)((lab_frand() - 0.5) * 2.0);   /* [-1,1) 混合正负 */
    b[i] = (TYPE)((lab_frand() - 0.5) * 2.0);
    c[i] = (TYPE)((lab_frand() - 0.5) * 2.0);
    d[i] = (TYPE)((lab_frand() - 0.5) * 2.0);
    e[i] = (TYPE)((lab_frand() - 0.5) * 2.0);
    xx_buf[i] = (TYPE)1.0;                      /* 模拟 TSVC set1d(xx,1.,1) */
  }
  for (int i = 0; i < LEN2; i++)
    for (int j = 0; j < LEN2; j++) {
      aa[i][j] = (TYPE)0.5;
      bb[i][j] = (TYPE)0.25;
      cc[i][j] = (TYPE)0.125;
    }
  lab_result = (TYPE)0;
  xx = xx_buf;
  yy = xx_buf;
}

/* ---- 参考快照与比对 ---- */
static TYPE ref_snap[6 * LEN];
static TYPE ref_result;

#define LAB_MAX_SAMPLES 8
static const char *lab_arr_names[6] = { "a", "b", "c", "d", "e", "xx" };
static struct { const char *arr; int idx; double ref; double got; } lab_mis[LAB_MAX_SAMPLES];
static int lab_nmis;

void lab_snapshot(void)
{
  const TYPE *cur[6] = { a, b, c, d, e, xx_buf };
  for (int k = 0; k < 6; k++)
    memcpy(ref_snap + (size_t)k * LEN, cur[k], (size_t)LEN * sizeof(TYPE));
  ref_result = lab_result;
}

int lab_compare(TYPE tol)
{
  const TYPE *cur[6] = { a, b, c, d, e, xx_buf };
  int bad = 0;
  lab_nmis = 0;
  for (int k = 0; k < 6; k++) {
    for (int i = 0; i < LEN; i++) {
      TYPE r = ref_snap[(size_t)k * LEN + i];
      if (FABS(cur[k][i] - r) > tol + tol * FABS(r)) {
        if (bad < LAB_MAX_SAMPLES) {
          lab_mis[bad].arr = lab_arr_names[k];
          lab_mis[bad].idx = i;
          lab_mis[bad].ref = (double)r;
          lab_mis[bad].got = (double)cur[k][i];
          lab_nmis = bad + 1;
        }
        bad++;
      }
    }
  }
  if (FABS(lab_result - ref_result) > tol + tol * FABS(ref_result)) {
    if (bad < LAB_MAX_SAMPLES) {
      lab_mis[bad].arr = "sum";
      lab_mis[bad].idx = 0;
      lab_mis[bad].ref = (double)ref_result;
      lab_mis[bad].got = (double)lab_result;
      lab_nmis = bad + 1;
    }
    bad++;
  }
  return bad;
}

/* JSON string of the first mismatches, e.g. [["b",0,1.2,3.4],...] */
static void lab_print_samples(void)
{
  putchar('[');
  for (int i = 0; i < lab_nmis; i++) {
    if (i) putchar(',');
    printf("[\"%s\",%d,%.17g,%.17g]", lab_mis[i].arr, lab_mis[i].idx, lab_mis[i].ref, lab_mis[i].got);
  }
  putchar(']');
}

double lab_now(void)
{
  return (double)clock() / (double)CLOCKS_PER_SEC;
}

/* ---- 面向 node 程序的入口框架 ---- */

/* 正确性指标: 六数组元素总和 + 归约结果 (与 main.c 基线一致) */
TYPE lab_checksum(void)
{
  TYPE s = 0;
  for (int i = 0; i < LEN; i++)
    s += a[i] + b[i] + c[i] + d[i] + e[i] + xx_buf[i];
  return s + lab_result;
}

/* 内核数据特化: 在 lab_init_data 之后、内核运行之前调用。
   s482: 抬高 b 使 c[i] > b[i] 恒不成立 (b∈[1.9,3.9), c∈(-1,1)),
         break 不触发, 循环跑满全长, 有实际优化意义。 */
void lab_prepare(const char *kernel)
{
  if (strcmp(kernel, "s482") == 0) {
    for (int i = 0; i < LEN; i++)
      b[i] += (TYPE)2.1;
  }
}

int lab_report_orig(const char *kernel, int rc, double t)
{
  TYPE cs = lab_checksum();
  printf("{\"kernel\":\"%s\",\"mode\":\"orig\",\"status\":\"%s\","
         "\"checksum\":%.17g,\"time\":%.6f}\n",
         kernel, rc == 0 ? "ok" : "error", (double)cs, t);
  fflush(stdout);
  return rc == 0 ? 0 : 1;
}

int lab_report_opt(const char *kernel, int rc_orig, int rc_opt,
                   double t_opt, TYPE cs_orig, double t_orig, TYPE tol)
{
  int code;
  if (rc_orig != 0) {           /* 参考运行失败 */
    printf("{\"kernel\":\"%s\",\"mode\":\"opt\",\"status\":\"error\","
           "\"checksum\":0,\"time\":0,\"checksum_orig\":0,"
           "\"time_orig\":%.6f,\"speedup\":0,\"mismatches\":-1}\n",
           kernel, t_orig);
    code = 1;
  } else if (rc_opt == 1) {     /* 占位: 优化版本尚未实现 */
    printf("{\"kernel\":\"%s\",\"mode\":\"opt\",\"status\":\"not_implemented\","
           "\"checksum\":0,\"time\":0,\"checksum_orig\":%.17g,"
           "\"time_orig\":%.6f,\"speedup\":0,\"mismatches\":-1}\n",
           kernel, (double)cs_orig, t_orig);
    code = 2;
  } else if (rc_opt != 0) {     /* 优化版本运行出错 */
    printf("{\"kernel\":\"%s\",\"mode\":\"opt\",\"status\":\"error\","
           "\"checksum\":0,\"time\":0,\"checksum_orig\":%.17g,"
           "\"time_orig\":%.6f,\"speedup\":0,\"mismatches\":-1}\n",
           kernel, (double)cs_orig, t_orig);
    code = 1;
  } else {
    int bad = lab_compare(tol);
    TYPE cs = lab_checksum();
    double sp = (t_opt > 0.0) ? t_orig / t_opt : 0.0;
    printf("{\"kernel\":\"%s\",\"mode\":\"opt\",\"status\":\"ok\","
           "\"checksum\":%.17g,\"time\":%.6f,\"checksum_orig\":%.17g,"
           "\"time_orig\":%.6f,\"speedup\":%.4f,\"mismatches\":%d",
           kernel, (double)cs, t_opt, (double)cs_orig, t_orig, sp, bad);
    if (bad) {
      printf(",\"mismatch_samples\":");
      lab_print_samples();
    }
    printf("}\n");
    code = bad ? 1 : 0;
  }
  fflush(stdout);
  return code;
}

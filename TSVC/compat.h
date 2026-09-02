/* TSVC Windows portability shim */
#ifdef _WIN32
#ifndef TSVC_HAS_POSIX_MEMALIGN
#include <stddef.h>
int posix_memalign(void **memptr, size_t alignment, size_t size);
#endif
#endif

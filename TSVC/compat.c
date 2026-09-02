/* TSVC Windows portability shim */
#ifdef _WIN32
#ifndef TSVC_HAS_POSIX_MEMALIGN
#include <malloc.h>
#include <errno.h>
int posix_memalign(void **memptr, size_t alignment, size_t size) {
    void *p = _aligned_malloc(size, alignment);
    if (!p) return ENOMEM;
    *memptr = p;
    return 0;
}
#endif
#endif

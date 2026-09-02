// void add(float *a, float *b, float *c, int n) {
//     for (int i = 0; i < n; i++) {
//         a[i] = b[i] + c[i];
//     }
// }

void s1(int *A, int Length) {
	#pragma clang loop vectorize(enable)
	for (int i = 0; i < Length; i++) {
		switch(A[i]) {
		case 0: A[i] = i*2; break;
		case 1: A[i] = i;   break;
		default: A[i] = 0;
		}
	}
}

void s2(int *arr, int n) {
	int pre = 0;
	for (int i = 0; i < n; i++) {
		pre += arr[i];
		arr[i] *= pre;
	}
}

int main() {
  return 0;
}
/**
 * pass@k / pass^k unbiased estimators (hypergeometric).
 *
 * R2 조사 근거: naive plug-in 추정 `(c/n)^k`는 위로 편향된 vanity metric.
 * n회 실행 중 c회 성공일 때 k회 샘플링의 정확한 기대값은 초기하 분포 조합으로 계산한다.
 *
 *   pass@k = 1 - C(n-c, k) / C(n, k)   — k번 중 1번 이상 성공할 확률
 *   pass^k = C(c, k) / C(n, k)         — k번 모두 성공할 확률 (일관성 지표)
 *
 * 참고: Chen et al. 2021 (Codex) — unbiased estimator for pass@k.
 */

export function combinations(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  const kk = Math.min(k, n - k);
  for (let i = 0; i < kk; i += 1) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/** k번 실행 중 1번 이상 성공할 확률의 무편향 추정 */
export function passAtK(total: number, successes: number, k: number): number | undefined {
  if (total <= 0 || k <= 0 || k > total) return undefined;
  const failures = total - successes;
  if (failures < k) return 1; // 실패만 k번 뽑는 게 불가능하면 반드시 1번은 성공
  return 1 - combinations(failures, k) / combinations(total, k);
}

/** k번 실행이 모두 성공할 확률의 무편향 추정 — 에이전트 일관성(신뢰성) 지표 */
export function passPowK(total: number, successes: number, k: number): number | undefined {
  if (total <= 0 || k <= 0 || k > total) return undefined;
  if (successes < k) return 0;
  return combinations(successes, k) / combinations(total, k);
}

/** 1..maxK까지의 곡선 — flakiness 리포트 시각화용 */
export function passKCurve(
  total: number,
  successes: number,
  maxK = 5
): Array<{ k: number; pass_at_k: number; pass_pow_k: number }> {
  const curve: Array<{ k: number; pass_at_k: number; pass_pow_k: number }> = [];
  for (let k = 1; k <= Math.min(maxK, total); k += 1) {
    const at = passAtK(total, successes, k);
    const pow = passPowK(total, successes, k);
    if (at !== undefined && pow !== undefined) {
      curve.push({ k, pass_at_k: at, pass_pow_k: pow });
    }
  }
  return curve;
}

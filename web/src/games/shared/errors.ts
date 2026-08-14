export function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

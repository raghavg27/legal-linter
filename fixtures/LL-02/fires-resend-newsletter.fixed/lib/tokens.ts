export function verifyToken(token: string | null): string {
  return token ?? '';
}
export function signToken(email: string): string {
  return email;
}

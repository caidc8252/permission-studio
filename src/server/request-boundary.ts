export function isExpectedHost(request: Request, expectedOrigin: string): boolean {
  const expectedHost = new URL(expectedOrigin).host.toLowerCase();
  const requestHost = new URL(request.url).host.toLowerCase();
  const headerHost = request.headers.get("host")?.toLowerCase();
  return (headerHost ?? requestHost) === expectedHost;
}

export function isExpectedMutation(request: Request, expectedOrigin: string): boolean {
  return (
    isExpectedHost(request, expectedOrigin) && request.headers.get("origin") === expectedOrigin
  );
}

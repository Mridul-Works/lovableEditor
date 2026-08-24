import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "le_session";

async function hasValidSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const secret = process.env.AUTH_SECRET;
  // Same floor as auth.ts, so a too-short secret fails closed in both places
  // rather than being rejected by one and accepted by the other.
  if (!secret || secret.length < 16) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin")) {
    const isLogin = pathname === "/admin/login";
    const authed = await hasValidSession(request);

    if (!authed && !isLogin) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = pathname === "/admin" ? "" : `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
    // The reverse redirect (signed in -> /admin) is deliberately NOT done here.
    // This check only proves the token's signature; it cannot see a revoked
    // session, so pairing it with the layout's database check would bounce a
    // revoked token between /admin and /admin/login forever. The login page
    // does that redirect itself, from the authoritative session.
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/admin"],
};

import { NextResponse } from 'next/server';

const PASSWORD = "Ngapain@220219"; // ganti password kamu

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // allow login page & static
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const isAuth = request.cookies.get("auth")?.value;

  if (isAuth === "true") {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

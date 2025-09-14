"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";

export function AppHeader() {
  const { data: session, status } = useSession();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/" });
  };

  if (status === "loading") {
    return (
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <Link
                href="/"
                className="text-xl font-semibold text-gray-900 transition-colors hover:text-orange-600"
              >
                PathForge
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200"></div>
            </div>
          </div>
        </div>
      </header>
    );
  }

  if (!session) {
    return (
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <Link
                href="/"
                className="text-xl font-semibold text-gray-900 transition-colors hover:text-orange-600"
              >
                PathForge
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/api/auth/signin"
                className="inline-flex items-center rounded-md border border-transparent bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:outline-none"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="border-b border-gray-200 bg-white shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link
              href="/"
              className="text-xl font-semibold text-gray-900 transition-colors hover:text-orange-600"
            >
              PathForge
            </Link>
            <nav className="hidden space-x-6 md:flex">
              <Link
                href="/"
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:text-orange-600"
              >
                Dashboard
              </Link>
              <Link
                href="/recentmap"
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:text-orange-600"
              >
                Activity Map
              </Link>
            </nav>
          </div>

          <div className="flex items-center space-x-4">
            <div className="relative">
              <button
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                className="flex items-center space-x-2 rounded-full text-sm focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:outline-none"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-600">
                  <span className="text-sm font-medium text-white">
                    {session.user?.name?.[0] ?? session.user?.email?.[0] ?? "U"}
                  </span>
                </div>
                <span className="text-gray-700">
                  {session.user?.name ?? session.user?.email}
                </span>
                <svg
                  className={`h-4 w-4 text-gray-400 transition-transform ${
                    isProfileMenuOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {isProfileMenuOpen && (
                <div className="absolute right-0 z-50 mt-2 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-gray-100 px-4 py-2 text-sm text-gray-700">
                    <div className="font-medium">{session.user?.name}</div>
                    <div className="text-gray-500">{session.user?.email}</div>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Backdrop to close menu when clicking outside */}
      {isProfileMenuOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsProfileMenuOpen(false)}
        />
      )}
    </header>
  );
}

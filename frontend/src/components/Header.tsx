"use client";

import { useSession, signIn, signOut } from "next-auth/react";

export default function Header() {
  const { data: session, status } = useSession();
  const isConnected = status === "authenticated";
  const isLoading = status === "loading";

  return (
    <header className="pixel-panel flex items-center justify-between px-6 py-3">
      <div className="flex items-center gap-3">
        <h1 className="text-sm text-[#c4727a] tracking-wider">PIXEL DJ</h1>
        <span className="text-[7px] text-[var(--text-dim)]">AI</span>
      </div>

      <div className="flex items-center gap-4">
        {isLoading ? (
          <span className="text-[7px] text-[var(--text-dim)]">LOADING...</span>
        ) : isConnected ? (
          <div className="flex items-center gap-3">
            {session.user?.image ? (
              <img
                src={session.user.image}
                alt=""
                className="w-6 h-6 border-2 border-[var(--border)]"
                style={{ imageRendering: "auto" }}
              />
            ) : (
              <div className="w-6 h-6 bg-[var(--pastel-lilac)] border-2 border-[var(--border)] flex items-center justify-center text-[6px]">
                {(session.user?.name?.[0] ?? "?").toUpperCase()}
              </div>
            )}
            <span className="text-[8px]">
              {session.user?.name ?? "user"}
            </span>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-[var(--pastel-green)]" />
              <span className="text-[6px] text-[#5a9b6a]">CONNECTED</span>
            </div>
            {session.error === "RefreshTokenError" && (
              <span className="text-[6px] text-[#c4727a]">TOKEN EXPIRED</span>
            )}
            <button
              className="pixel-btn pixel-btn-pink text-[6px] px-2 py-1"
              onClick={() => signOut()}
            >
              DISCONNECT
            </button>
          </div>
        ) : (
          <button
            className="pixel-btn pixel-btn-green text-[7px]"
            onClick={() => signIn("spotify")}
          >
            CONNECT SPOTIFY
          </button>
        )}
      </div>
    </header>
  );
}

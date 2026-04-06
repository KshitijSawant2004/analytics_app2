import { useEffect } from "react";
import { useRouter } from "next/router";

export default function LegacyReplayRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;

    const sessionId = String(router.query.sessionId || router.query.session_id || "").trim();
    const userId = String(router.query.userId || router.query.user_id || "").trim();

    const query = {};
    if (sessionId) query.sessionId = sessionId;
    if (userId) query.userId = userId;

    router.replace({
      pathname: "/session-replays",
      query,
    });
  }, [router]);

  return null;
}

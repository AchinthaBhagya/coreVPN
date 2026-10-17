import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuroraBackdrop } from "@/components/common/AuroraBackdrop";
import { useAuth } from "@/context/AuthContext";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

const ERROR_MESSAGES: Record<string, string> = {
  google_not_configured: "Google sign-in is not configured yet. Please use your email and password.",
  invalid_state: "Your sign-in attempt expired. Please try again.",
  token_exchange_failed: "We could not complete the sign-in with Google. Please try again.",
  invalid_id_token: "Google returned an unexpected response. Please try again.",
  pending_approval: "Your account is awaiting approval by an administrator.",
  email_not_verified: "Please verify your email address before signing in.",
  no_account: "No account was found for that Google email. Please create an account first.",
  client_role_missing: "The client portal is not set up yet. Please contact support.",
  oauth_failed: "Google sign-in failed. Please try again.",
};

export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const errorCode = params.get("error");
  const status = params.get("status");
  const next = params.get("next");

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (errorCode) {
        if (active) {
          setError(ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.oauth_failed);
          setLoading(false);
        }
        return;
      }

      if (status === "success") {
        const user = await refresh();
        if (!active) return;
        if (!user) {
          setError("We could not establish your session. Please sign in again.");
          setLoading(false);
          return;
        }
        const fallback = user.isClient ? "/portal" : "/dashboard";
        navigate(next && next.startsWith("/") ? next : fallback, { replace: true });
        return;
      }

      // Nothing to do (e.g. direct visit).
      if (active) {
        setError("Nothing to complete. Please sign in.");
        setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="isolate relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <AuroraBackdrop />
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="aurora-frame glass-strong sheen relative w-full max-w-md overflow-hidden rounded-3xl p-8 text-center"
      >
        {loading && !error ? (
          <div className="space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-info/30 bg-info/10">
              <Loader2 className="h-7 w-7 animate-spin text-info" />
            </div>
            <div className="space-y-1">
              <h1 className="font-display text-xl font-semibold">Finishing sign-in</h1>
              <p className="text-sm text-muted-foreground">Just a moment...</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10">
              <ShieldX className="h-7 w-7 text-destructive" />
            </div>
            <div className="space-y-1">
              <h1 className="font-display text-xl font-semibold">Sign-in not completed</h1>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link to="/login">Back to sign in</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link to="/register">Create an account</Link>
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

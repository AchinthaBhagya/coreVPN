import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, MailCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { toast } from "@/hooks/use-toast";

type Status = "verifying" | "success" | "error";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [status, setStatus] = useState<Status>(token ? "verifying" : "error");
  const [message, setMessage] = useState(token ? "" : "This verification link is missing its token.");
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);

  const verify = useCallback(async () => {
    if (!token) return;
    setStatus("verifying");
    try {
      await api.post("/auth/verify-email", { token });
      setStatus("success");
      setMessage("Your email address has been verified. You can now sign in.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof ApiError ? error.message : "This verification link is invalid or has expired.");
    }
  }, [token]);

  useEffect(() => {
    void verify();
  }, [verify]);

  const resend = async () => {
    if (!resendEmail.trim()) return;
    setResending(true);
    try {
      await api.post("/auth/resend-verification", { email: resendEmail.trim() });
      toast({
        title: "Verification email requested",
        description: "If that account still needs verification, a new link is on its way.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not request a new link",
        description: error instanceof ApiError ? error.message : undefined,
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-96 w-96 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-amber-500/15 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative w-full max-w-md overflow-hidden rounded-3xl glass sheen p-8 text-center"
      >
        {status === "verifying" ? (
          <div className="space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-info/30 bg-info/10">
              <Loader2 className="h-7 w-7 animate-spin text-info" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">Verifying your email</h1>
              <p className="text-sm text-muted-foreground">This will only take a moment.</p>
            </div>
          </div>
        ) : status === "success" ? (
          <div className="space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-success/30 bg-success/10">
              <CheckCircle2 className="h-7 w-7 text-success" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">Email verified</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>
            <Button asChild className="w-full">
              <Link to="/login">Continue to sign in</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10">
              <ShieldX className="h-7 w-7 text-destructive" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">Verification failed</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>

            <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4 text-left">
              <p className="flex items-center gap-2 text-sm font-medium">
                <MailCheck className="h-4 w-4 text-muted-foreground" />
                Request a new link
              </p>
              <Input
                type="email"
                placeholder="you@company.com"
                value={resendEmail}
                onChange={(event) => setResendEmail(event.target.value)}
              />
              <Button size="sm" className="w-full" onClick={resend} disabled={resending}>
                {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send a new verification email
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              <Link to="/login" className="font-medium text-primary hover:underline">
                Back to sign in
              </Link>
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Loader2, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { GoogleMark } from "@/components/common/GoogleMark";
import { toast } from "@/hooks/use-toast";
import { FullPageLoader } from "@/components/layout/guards";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function Login() {
  const { login, user, isBootstrapping } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSending, setResetSending] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const redirectTarget = (isClient: boolean) => {
    const from = (location.state as { from?: string } | null)?.from;
    if (isClient) return "/portal";
    return from && from !== "/login" ? from : "/dashboard";
  };

  useEffect(() => {
    if (!isBootstrapping && user) navigate(redirectTarget(user.isClient), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isBootstrapping]);

  useEffect(() => {
    api
      .get<{ google: boolean }>("/auth/providers")
      .then((data) => setGoogleEnabled(Boolean(data?.google)))
      .catch(() => setGoogleEnabled(false));
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const authed = await login(values.email.trim(), values.password);
      toast({ title: "Welcome back", description: `Signed in as ${authed.email}` });
      navigate(redirectTarget(authed.isClient), { replace: true });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to sign in. Please try again.";
      form.setError("password", { message });
      toast({ variant: "destructive", title: "Sign in failed", description: message });
    } finally {
      setSubmitting(false);
    }
  });

  const sendReset = async () => {
    if (!resetEmail.trim()) return;
    setResetSending(true);
    try {
      await api.post("/auth/forgot-password", { email: resetEmail.trim() });
      toast({ title: "Check your inbox", description: "If that email is registered, a reset link has been sent." });
      setResetOpen(false);
      setResetEmail("");
    } catch (error) {
      toast({ variant: "destructive", title: "Could not send reset email", description: error instanceof Error ? error.message : undefined });
    } finally {
      setResetSending(false);
    }
  };

  if (isBootstrapping) return <FullPageLoader />;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05070d] px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/10 blur-3xl" />
      </div>

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-2xl backdrop-blur-2xl lg:grid-cols-2">
        <div className="hidden flex-col justify-between gap-8 border-r border-white/10 bg-gradient-to-br from-sky-500/10 via-transparent to-violet-600/10 p-10 lg:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-[#0f0f0f] ring-1 ring-white/10">
              <img src="/logo.png" alt="3xCodz" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight">3xCodz</p>
              <p className="text-xs text-muted-foreground">Management System</p>
            </div>
          </div>
          <div className="space-y-4">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">
              Run your whole agency from one calm, secure workspace.
            </h1>
            <p className="text-sm text-muted-foreground">
              Clients, projects, delivery, finance and profit distribution - unified, permission-aware and auditable.
            </p>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {["Role-based access on every endpoint", "Transparent profit allocation & payouts", "Client portal with secure file delivery"].map((line) => (
              <li key={line} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-sky-400 to-violet-500" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="p-8 sm:p-10">
          <div className="mb-8 space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">Use your work email and password to continue.</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">
                Email address
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" className="pl-9" {...form.register("email")} />
              </div>
              {form.formState.errors.email ? (
                <p className="text-xs font-medium text-destructive">{form.formState.errors.email.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                  Password
                </Label>
                <button type="button" onClick={() => setResetOpen(true)} className="text-xs font-medium text-primary hover:underline">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="password" type="password" autoComplete="current-password" placeholder="••••••••" className="pl-9" {...form.register("password")} />
              </div>
              {form.formState.errors.password ? (
                <p className="text-xs font-medium text-destructive">{form.formState.errors.password.message}</p>
              ) : null}
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          {googleEnabled ? (
            <>
              <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className="h-px flex-1 bg-white/10" />
                or
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <Button asChild variant="outline" className="w-full">
                <a href="/api/auth/google">
                  <GoogleMark />
                  Continue with Google
                </a>
              </Button>
            </>
          ) : null}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create one
            </Link>
          </p>

          {resetOpen ? (
            <Card className="mt-6">
              <CardContent className="space-y-3 p-4">
                <p className="text-sm font-medium">Reset your password</p>
                <p className="text-xs text-muted-foreground">
                  Enter your email and we'll send a reset link if the account exists.
                </p>
                <Input type="email" placeholder="you@company.com" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setResetOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={sendReset} disabled={resetSending}>
                    {resetSending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Send link
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <p className="mt-8 text-center text-[11px] text-muted-foreground">
            Protected by role-based access control and full audit logging.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

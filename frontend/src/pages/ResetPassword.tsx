import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { fieldErrors } from "@/lib/errors";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { toast } from "@/hooks/use-toast";
import { passwordPolicy } from "@/lib/validation";

const resetSchema = z
  .object({
    newPassword: z.string().min(1, "A new password is required"),
    confirmPassword: z.string().min(1, "Please confirm the password"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ResetValues = z.infer<typeof resetSchema>;

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!token) {
      toast({ variant: "destructive", title: "Missing reset token", description: "This reset link is invalid." });
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword: values.newPassword });
      toast({ title: "Password updated", description: "You can now sign in with your new password." });
      navigate("/login", { replace: true });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to reset the password.";
      const fields = fieldErrors(error);
      if (fields.newPassword) form.setError("newPassword", { message: fields.newPassword });
      else if (fields.confirmPassword) form.setError("confirmPassword", { message: fields.confirmPassword });
      toast({ variant: "destructive", title: "Reset failed", description: message });
    } finally {
      setSubmitting(false);
    }
  });

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
        className="relative w-full max-w-md overflow-hidden rounded-3xl glass sheen p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl gold-gradient shadow-lg shadow-primary/30">
            <KeyRound className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight">Choose a new password</p>
            <p className="text-xs text-muted-foreground">This link can only be used once.</p>
          </div>
        </div>

        {!token ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This reset link is missing its token. Request a new password reset email from the sign-in page.
            </p>
            <Button asChild className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword" className="text-xs font-medium text-muted-foreground">
                New password
              </Label>
              <Input id="newPassword" type="password" autoComplete="new-password" {...form.register("newPassword")} />
              {form.formState.errors.newPassword ? (
                <p className="text-xs font-medium text-destructive">{form.formState.errors.newPassword.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{passwordPolicy.summary}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-xs font-medium text-muted-foreground">
                Confirm password
              </Label>
              <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
              {form.formState.errors.confirmPassword ? (
                <p className="text-xs font-medium text-destructive">{form.formState.errors.confirmPassword.message}</p>
              ) : null}
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {submitting ? "Updating..." : "Update password"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Passwords are hashed with bcrypt and never stored in plain text.
        </p>
      </motion.div>
    </div>
  );
}

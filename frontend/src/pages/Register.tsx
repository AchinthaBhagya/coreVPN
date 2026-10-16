import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Building2, CheckCircle2, Loader2, Lock, Mail, Phone, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { passwordPolicy, passwordSchema } from "@/lib/validation";
import { fieldErrors } from "@/lib/errors";
import { GoogleMark } from "@/components/common/GoogleMark";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { toast } from "@/hooks/use-toast";

const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    email: z.string().min(1, "Email is required").email("Enter a valid email"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm the password"),
    phone: z.string().trim().max(40),
    companyName: z.string().trim().max(160),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type RegisterValues = z.infer<typeof registerSchema>;
type AccountType = "CLIENT" | "STAFF";

interface RegisterResult {
  accountType: AccountType;
  mailSent: boolean;
}

const ACCOUNT_TYPES: Array<{ value: AccountType; title: string; description: string; icon: typeof Users }> = [
  {
    value: "CLIENT",
    title: "Customer",
    description: "Track your projects, quotations and invoices in the client portal.",
    icon: Building2,
  },
  {
    value: "STAFF",
    title: "Team member",
    description: "Join the internal workspace. An owner approves your access.",
    icon: Users,
  },
];

export default function Register() {
  const [accountType, setAccountType] = useState<AccountType>("CLIENT");
  const [submitting, setSubmitting] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [done, setDone] = useState<RegisterResult | null>(null);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      phone: "",
      companyName: "",
    },
  });

  useEffect(() => {
    api
      .get<{ google: boolean }>("/auth/providers")
      .then((data) => setGoogleEnabled(Boolean(data?.google)))
      .catch(() => setGoogleEnabled(false));
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const result = await api.post<RegisterResult>("/auth/register", {
        accountType,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        password: values.password,
        phone: values.phone.trim() || null,
        companyName: accountType === "CLIENT" ? values.companyName.trim() || null : null,
      });
      setDone({ accountType: result?.accountType ?? accountType, mailSent: Boolean(result?.mailSent) });
    } catch (error) {
      const fields = fieldErrors(error);
      (["firstName", "lastName", "email", "password", "confirmPassword"] as const).forEach((key) => {
        if (fields[key]) form.setError(key, { message: fields[key] });
      });
      toast({
        variant: "destructive",
        title: "Could not create account",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  });

  const googleHref = `/api/auth/google?type=${accountType}`;

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
        className="relative w-full max-w-lg overflow-hidden rounded-3xl glass sheen p-8 sm:p-10"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-[#0f0f0f] ring-1 ring-border">
            <img src="/logo.png" alt="3xCodz" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight">Create your account</p>
            <p className="text-xs text-muted-foreground">3xCodz Management System</p>
          </div>
        </div>

        {done ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  {done.accountType === "STAFF" ? "Account created" : "Almost there"}
                </p>
                <p className="text-muted-foreground">
                  {done.accountType === "STAFF"
                    ? "Your team account is awaiting approval. You'll be able to sign in once an owner activates it."
                    : done.mailSent
                      ? "We've emailed you a verification link. Click it to activate your account, then sign in."
                      : "Your account was created, but we could not send the verification email. Please contact support to activate it."}
                </p>
              </div>
            </div>
            <Button asChild className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3">
              {ACCOUNT_TYPES.map((type) => {
                const Icon = type.icon;
                const active = accountType === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setAccountType(type.value)}
                    className={`rounded-2xl border p-3 text-left transition ${
                      active
                        ? "border-primary/50 bg-info/10 ring-1 ring-primary/40"
                        : "border-border bg-muted/20 hover:border-border"
                    }`}
                  >
                    <Icon className={`mb-2 h-4 w-4 ${active ? "text-info" : "text-muted-foreground"}`} />
                    <p className="text-sm font-medium">{type.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{type.description}</p>
                  </button>
                );
              })}
            </div>

            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName" className="text-xs font-medium text-muted-foreground">
                    First name
                  </Label>
                  <Input id="firstName" autoComplete="given-name" {...form.register("firstName")} />
                  {form.formState.errors.firstName ? (
                    <p className="text-xs font-medium text-destructive">{form.formState.errors.firstName.message}</p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName" className="text-xs font-medium text-muted-foreground">
                    Last name
                  </Label>
                  <Input id="lastName" autoComplete="family-name" {...form.register("lastName")} />
                  {form.formState.errors.lastName ? (
                    <p className="text-xs font-medium text-destructive">{form.formState.errors.lastName.message}</p>
                  ) : null}
                </div>
              </div>

              {accountType === "CLIENT" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="companyName" className="text-xs font-medium text-muted-foreground">
                    Company name <span className="text-muted-foreground/60">(optional)</span>
                  </Label>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="companyName" className="pl-9" placeholder="Your company" {...form.register("companyName")} />
                  </div>
                </div>
              ) : null}

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
                <Label htmlFor="phone" className="text-xs font-medium text-muted-foreground">
                  Phone <span className="text-muted-foreground/60">(optional)</span>
                </Label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="phone" type="tel" autoComplete="tel" className="pl-9" {...form.register("phone")} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="password" type="password" autoComplete="new-password" className="pl-9" {...form.register("password")} />
                  </div>
                  {form.formState.errors.password ? (
                    <p className="text-xs font-medium text-destructive">{form.formState.errors.password.message}</p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword" className="text-xs font-medium text-muted-foreground">
                    Confirm password
                  </Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="confirmPassword" type="password" autoComplete="new-password" className="pl-9" {...form.register("confirmPassword")} />
                  </div>
                  {form.formState.errors.confirmPassword ? (
                    <p className="text-xs font-medium text-destructive">{form.formState.errors.confirmPassword.message}</p>
                  ) : null}
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">{passwordPolicy.summary}</p>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {submitting ? "Creating account..." : "Create account"}
              </Button>
            </form>

            {googleEnabled ? (
              <>
                <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span className="h-px flex-1 bg-muted/60" />
                  or
                  <span className="h-px flex-1 bg-muted/60" />
                </div>
                <Button asChild variant="outline" className="w-full">
                  <a href={googleHref}>
                    <GoogleMark />
                    Continue with Google
                  </a>
                </Button>
              </>
            ) : null}

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}

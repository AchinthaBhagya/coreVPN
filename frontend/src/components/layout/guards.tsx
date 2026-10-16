import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export function FullPageLoader({ label = "Preparing your workspace..." }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl gold-gradient shadow-lg shadow-primary/20">
        <Loader2 className="h-6 w-6 animate-spin text-primary-foreground" />
      </div>
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function Forbidden() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive">
        <ShieldAlert className="h-7 w-7" />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Access denied</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          You don't have permission to view this page. If you believe this is a mistake, contact an administrator.
        </p>
      </div>
      <Button variant="outline" onClick={() => navigate(-1)}>
        Go back
      </Button>
    </div>
  );
}

/** Guards internal (staff) routes. Client accounts are pushed to the portal. */
export function ProtectedRoute({ permission, anyOf, children }: { permission?: string | string[]; anyOf?: string[]; children?: ReactNode }) {
  const { user, isBootstrapping, canAny } = useAuth();
  const location = useLocation();

  if (isBootstrapping) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.isClient) return <Navigate to="/portal" replace />;

  const required = anyOf ?? (Array.isArray(permission) ? permission : permission ? [permission] : []);
  if (required.length > 0 && !canAny(...required)) return <Forbidden />;

  return <>{children ?? <Outlet />}</>;
}

/** Guards client-portal routes. Staff are redirected to the dashboard. */
export function PortalRoute({ anyOf, children }: { anyOf?: string[]; children?: ReactNode }) {
  const { user, isBootstrapping, canAny } = useAuth();
  const location = useLocation();

  if (isBootstrapping) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!user.isClient) return <Navigate to="/dashboard" replace />;
  if (anyOf && anyOf.length > 0 && !canAny(...anyOf)) return <Forbidden />;

  return <>{children ?? <Outlet />}</>;
}

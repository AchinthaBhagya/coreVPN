import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
        <Compass className="h-7 w-7" />
      </div>
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">404</h1>
        <p className="text-sm text-muted-foreground">We couldn't find the page you were looking for.</p>
      </div>
      <Button asChild>
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}

import { LogOut, Settings, UserRound, BellRing } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { initials } from "@/lib/format";

export function UserMenu({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  const displayName = `${user.firstName} ${user.lastName}`.trim();
  const roleLabel = user.roles.map((role) => role.name).join(", ") || "Member";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2">
          <Avatar className="h-8 w-8 border border-border">
            <AvatarImage src={user.avatarId ? `/api/attachments/${user.avatarId}` : undefined} alt={displayName} />
            <AvatarFallback className="gold-gradient text-xs font-semibold text-primary-foreground">
              {initials(user.firstName, user.lastName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-left md:block">
            <span className="block text-xs font-medium leading-tight text-foreground">{displayName}</span>
            <span className="block text-[11px] leading-tight text-muted-foreground">{roleLabel}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="text-sm font-medium">{displayName}</p>
          <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onNavigate(user.isClient ? "/portal/profile" : "/settings/profile")}>
          <UserRound className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onNavigate("/settings/notifications")}>
          <BellRing className="mr-2 h-4 w-4" />
          Notifications
        </DropdownMenuItem>
        {!user.isClient ? (
          <DropdownMenuItem onClick={() => onNavigate("/settings/company")}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            void logout();
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

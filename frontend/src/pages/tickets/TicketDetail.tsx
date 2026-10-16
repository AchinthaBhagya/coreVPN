import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Send, ShieldCheck, UserRound, X } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiQuery } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { toastError, toastSuccess } from "@/lib/errors";
import { clientDisplayName, formatDateTime, humanize, initials } from "@/lib/format";
import { OPTIONS } from "@/lib/status";
import { DetailHeader } from "@/components/common/DetailHeader";
import { InfoList, SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AsyncBoundary, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { PersonRef, Ticket, TicketMessage } from "@/types";

type DetailMessage = TicketMessage & { authorId?: string };
type TicketDetailData = Ticket & { messages?: DetailMessage[] };

function personName(person?: { firstName: string; lastName: string } | null): string {
  if (!person) return "-";
  return `${person.firstName} ${person.lastName}`.trim() || "-";
}

export default function TicketDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const canUpdate = can("tickets.update");
  const canAssign = can("tickets.assign");
  const canClose = can("tickets.close");

  const ticketQuery = useApiQuery<TicketDetailData>(qk.detail("tickets", id), `/tickets/${id}`, undefined, {
    enabled: Boolean(id),
  });
  const assignableQuery = useApiQuery<PersonRef[]>(["users", "assignable"], "/users/assignable", undefined, {
    enabled: canAssign,
  });

  const [replyBody, setReplyBody] = useState("");
  const [replyInternal, setReplyInternal] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  const replyMutation = useMutation({
    mutationFn: (vars: { body: string; isInternal: boolean }) =>
      api.post<DetailMessage>(`/tickets/${id}/messages`, vars),
    onSuccess: () => {
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const assignMutation = useMutation({
    mutationFn: (assignedToId: string | null) => api.post<Ticket>(`/tickets/${id}/assign`, { assignedToId }),
    onSuccess: () => {
      toastSuccess("Ticket assigned");
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.patch<Ticket>(`/tickets/${id}`, { status }),
    onSuccess: () => {
      toastSuccess("Status updated");
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const resolveMutation = useMutation({
    mutationFn: (resolutionSummary: string) =>
      api.post<Ticket>(`/tickets/${id}/resolve`, { resolutionSummary: resolutionSummary || undefined }),
    onSuccess: () => {
      toastSuccess("Ticket resolved");
      setResolveOpen(false);
      setResolutionSummary("");
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const ticket = ticketQuery.data;

  const clientMessages = useMemo(() => {
    if (!ticket?.client) return new Set<string>();
    // The API does not expose message author ids, so a message counts as the
    // client's when its author matches the client contact's name.
    return new Set(
      (ticket.messages ?? [])
        .filter(
          (message) =>
            message.author &&
            message.author.firstName === ticket.client!.firstName &&
            message.author.lastName === ticket.client!.lastName,
        )
        .map((message) => message.id),
    );
  }, [ticket]);

  const sendReply = () => {
    const body = replyBody.trim();
    if (!body) return;
    replyMutation.mutate(
      { body, isInternal: replyInternal },
      {
        onSuccess: () => {
          setReplyBody("");
          setReplyInternal(false);
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <AsyncBoundary
        isLoading={ticketQuery.isLoading}
        isError={ticketQuery.isError}
        error={ticketQuery.error}
        onRetry={() => ticketQuery.refetch()}
      >
        {!ticket ? (
          <ErrorState title="Ticket not found" description="This ticket may have been removed." />
        ) : (
          <>
            <DetailHeader
              backTo="/tickets"
              backLabel="Back to tickets"
              title={
                <span className="flex items-center gap-3">
                  <span className="font-mono text-base text-primary">{ticket.ticketNo}</span>
                  <span>{ticket.subject}</span>
                </span>
              }
              subtitle={`Raised ${formatDateTime(ticket.createdAt)}${ticket.client ? ` by ${clientDisplayName(ticket.client)}` : ""}`}
              badge={
                <span className="flex items-center gap-2">
                  <StatusBadge status={ticket.status} />
                  <StatusBadge status={ticket.priority} label={`Priority: ${humanize(ticket.priority)}`} />
                </span>
              }
              actions={
                <>
                  {canUpdate ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" disabled={statusMutation.isPending}>
                          {humanize(ticket.status)}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Change status</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {OPTIONS.ticketStatus.map((status) => (
                          <DropdownMenuItem
                            key={status}
                            disabled={status === ticket.status || statusMutation.isPending}
                            onClick={() => statusMutation.mutate(status)}
                          >
                            {humanize(status)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}

                  {canAssign ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" disabled={assignMutation.isPending}>
                          <UserRound className="h-4 w-4" />
                          {ticket.assignedTo ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}` : "Assign"}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                        <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {(assignableQuery.data ?? []).map((user) => (
                          <DropdownMenuItem
                            key={user.id}
                            disabled={assignMutation.isPending || user.id === ticket.assignedToId}
                            onClick={() => assignMutation.mutate(user.id)}
                          >
                            {user.firstName} {user.lastName}
                          </DropdownMenuItem>
                        ))}
                        {ticket.assignedToId ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={assignMutation.isPending}
                              onClick={() => assignMutation.mutate(null)}
                            >
                              <X className="h-4 w-4" />
                              Unassign
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}

                  {canClose && ticket.status !== "RESOLVED" && ticket.status !== "CLOSED" ? (
                    <Button size="sm" onClick={() => setResolveOpen(true)}>
                      <CheckCircle2 className="h-4 w-4" />
                      Resolve
                    </Button>
                  ) : null}
                </>
              }
            />

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <SectionCard title="Conversation" description="The original request and every reply, oldest first.">
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-muted/25 p-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/60 text-[10px] font-semibold">
                            {initials(ticket.client?.firstName, ticket.client?.lastName)}
                          </span>
                          <span className="text-sm font-medium">{clientDisplayName(ticket.client)}</span>
                          <Badge variant="outline">Request</Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDateTime(ticket.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{ticket.description}</p>
                    </div>

                    {(ticket.messages ?? []).length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No replies yet. Use the box below to respond.
                      </p>
                    ) : (
                      (ticket.messages ?? []).map((message) => {
                        const fromClient = clientMessages.has(message.id);
                        return (
                          <div
                            key={message.id}
                            className={`rounded-xl border p-4 ${
                              message.isInternal
                                ? "border-warning/30 bg-warning/10"
                                : fromClient
                                  ? "border-info/20 bg-info/10 lg:ml-12"
                                  : "border-border bg-muted/25"
                            }`}
                          >
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/60 text-[10px] font-semibold">
                                  {initials(message.author?.firstName, message.author?.lastName)}
                                </span>
                                <span className="text-sm font-medium">{personName(message.author)}</span>
                                <Badge variant={fromClient ? "info" : "muted"}>
                                  {fromClient ? "Client" : "Staff"}
                                </Badge>
                                {message.isInternal ? (
                                  <Badge variant="warning">
                                    <ShieldCheck className="mr-1 h-3 w-3" />
                                    Internal note
                                  </Badge>
                                ) : null}
                              </div>
                              <span className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)}</span>
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{message.body}</p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </SectionCard>

                {canUpdate ? (
                  <SectionCard title="Reply" description="Replies are visible to the client unless marked as an internal note.">
                    <div className="space-y-3">
                      <Textarea
                        value={replyBody}
                        onChange={(event) => setReplyBody(event.target.value)}
                        rows={5}
                        placeholder="Write a reply..."
                      />
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                          <Checkbox
                            checked={replyInternal}
                            onCheckedChange={(checked) => setReplyInternal(Boolean(checked))}
                          />
                          Internal note (hidden from client)
                        </label>
                        <Button
                          size="sm"
                          onClick={sendReply}
                          disabled={!replyBody.trim() || replyMutation.isPending}
                        >
                          {replyMutation.isPending ? (
                            <Send className="h-4 w-4 animate-pulse" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          {replyInternal ? "Add note" : "Send reply"}
                        </Button>
                      </div>
                    </div>
                  </SectionCard>
                ) : null}
              </div>

              <div className="space-y-6">
                <SectionCard title="Details">
                  <InfoList
                    columns={1}
                    items={[
                      { label: "Client", value: clientDisplayName(ticket.client) },
                      { label: "Category", value: humanize(ticket.category) },
                      {
                        label: "Assignee",
                        value: ticket.assignedTo ? (
                          personName(ticket.assignedTo)
                        ) : (
                          <span className="italic text-muted-foreground">Unassigned</span>
                        ),
                      },
                      {
                        label: "Created",
                        value: `${formatDateTime(ticket.createdAt)}${ticket.createdBy ? ` by ${personName(ticket.createdBy)}` : ""}`,
                      },
                      { label: "First response", value: formatDateTime(ticket.firstResponseAt) },
                      { label: "Last reply", value: formatDateTime(ticket.lastReplyAt) },
                    ]}
                  />
                </SectionCard>

                <SectionCard
                  title="Resolution"
                  empty={!ticket.resolutionSummary}
                  emptyTitle="Not resolved yet"
                  emptyDescription="A resolution summary is recorded when the ticket is resolved."
                >
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{ticket.resolutionSummary}</p>
                  {ticket.resolvedAt ? (
                    <p className="mt-3 text-xs text-muted-foreground">Resolved {formatDateTime(ticket.resolvedAt)}</p>
                  ) : null}
                </SectionCard>

                {ticket.status === "CLOSED" ? (
                  <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/25 p-4 text-sm text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <p>This ticket is closed. Further replies are disabled in the client portal.</p>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </AsyncBoundary>

      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve ticket {ticket?.ticketNo}</DialogTitle>
            <DialogDescription>
              Mark this ticket as resolved. Optionally record a summary of the resolution.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={resolutionSummary}
            onChange={(event) => setResolutionSummary(event.target.value)}
            rows={4}
            placeholder="How was this resolved? (optional)"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolveOpen(false)} disabled={resolveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => resolveMutation.mutate(resolutionSummary)} disabled={resolveMutation.isPending}>
              <CheckCircle2 className="h-4 w-4" />
              {resolveMutation.isPending ? "Resolving..." : "Mark as resolved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

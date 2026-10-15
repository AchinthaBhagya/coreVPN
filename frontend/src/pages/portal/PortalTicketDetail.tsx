import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Loader2, MessageSquare, Paperclip, Send } from "lucide-react";
import { api, ApiError, downloadBlob } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiQuery } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { toastError, toastSuccess } from "@/lib/errors";
import { formatBytes, formatDate, formatDateTime, formatRelative, humanize } from "@/lib/format";
import { DetailHeader } from "@/components/common/DetailHeader";
import { SectionCard, InfoList } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { cn } from "@/lib/utils";
import type { Attachment, Ticket } from "@/types";

/** The portal ticket endpoint omits `isInternal` from messages (always false here). */
interface PortalTicketMessage {
  id: string;
  body: string;
  createdAt: string;
  author: { firstName: string; lastName: string } | null;
}

interface PortalTicket extends Omit<Ticket, "messages"> {
  messages: PortalTicketMessage[];
  attachments: Attachment[];
}

function personName(person: { firstName: string; lastName: string } | null | undefined): string {
  return person ? `${person.firstName} ${person.lastName}`.trim() : "";
}

function MessageBubble({
  body,
  authorLabel,
  createdAt,
  isClient,
}: {
  body: string;
  authorLabel: string;
  createdAt: string;
  isClient: boolean;
}) {
  return (
    <div className={cn("max-w-[85%] space-y-1.5 rounded-xl border p-3", isClient ? "ml-auto border-sky-500/30 bg-sky-500/10" : "border-white/10 bg-white/[0.03]")}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className={cn("font-medium", isClient ? "text-sky-300" : "text-foreground")}>{authorLabel}</span>
        <span>{formatDateTime(createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground">{body}</p>
    </div>
  );
}

export default function PortalTicketDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const queryClient = useQueryClient();

  const [reply, setReply] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const query = useApiQuery<PortalTicket>(qk.portal.ticket(id), `/portal/tickets/${id}`, undefined, {
    enabled: Boolean(id),
  });

  const replyMutation = useMutation({
    mutationFn: (body: string) => api.post(`/portal/tickets/${id}/messages`, { body }),
    onSuccess: () => {
      toastSuccess("Reply sent", "Your reply has been added to the ticket.");
      setReply("");
      queryClient.invalidateQueries({ queryKey: qk.portal.ticket(id) });
      queryClient.invalidateQueries({ queryKey: qk.portal.tickets });
    },
    onError: (error) => toastError(error, "Your reply could not be sent."),
  });

  async function downloadAttachment(attachment: Attachment) {
    setDownloadingId(attachment.id);
    try {
      const blob = await api.blob(`/attachments/${attachment.id}`, { download: "true" });
      downloadBlob(blob, attachment.originalName);
    } catch (error) {
      toastError(error, "This file could not be downloaded.");
    } finally {
      setDownloadingId(null);
    }
  }

  if (query.isLoading) return <LoadingState label="Loading ticket..." />;

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    if (notFound) {
      return (
        <div className="space-y-6">
          <EmptyState
            icon={<MessageSquare className="h-6 w-6" />}
            title="Ticket not found"
            description="This ticket doesn't exist or doesn't belong to your account."
            action={
              <Button variant="outline" onClick={() => navigate("/portal/tickets")}>
                Back to tickets
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <ErrorState
        title="We couldn't load this ticket"
        description={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const ticket = query.data;
  if (!ticket) return <ErrorState description="This ticket could not be loaded." onRetry={() => void query.refetch()} />;

  const isClosed = ticket.status === "CLOSED";
  const canReply = can("portal.tickets.update") && !isClosed;
  const clientNames = user ? `${user.firstName} ${user.lastName}`.trim().toLowerCase() : "";

  return (
    <div className="space-y-6">
      <DetailHeader
        backTo="/portal/tickets"
        backLabel="Support tickets"
        title={ticket.subject}
        subtitle={
          <span>
            {ticket.ticketNo} · {humanize(ticket.category)} · Opened {formatDate(ticket.createdAt)}
          </span>
        }
        badge={
          <span className="flex items-center gap-2">
            <StatusBadge status={ticket.status} />
            <StatusBadge status={ticket.priority} label={`Priority: ${humanize(ticket.priority)}`} />
          </span>
        }
      />

      {ticket.resolutionSummary ? (
        <Alert className="border-emerald-500/30 bg-emerald-500/10">
          <CheckCircle2 className="h-4 w-4 text-emerald-300" />
          <AlertTitle className="text-emerald-200">Resolution summary</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap text-emerald-200/80">
            {ticket.resolutionSummary}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title="Conversation" description="Messages exchanged with the 3xCodz team.">
            <div className="space-y-4">
              <MessageBubble
                body={ticket.description}
                authorLabel="You"
                createdAt={ticket.createdAt}
                isClient
              />
              {ticket.messages.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No replies yet — our team will respond here.
                </p>
              ) : (
                ticket.messages.map((message) => {
                  const author = personName(message.author);
                  const isMine = author.toLowerCase() === clientNames;
                  return (
                    <MessageBubble
                      key={message.id}
                      body={message.body}
                      authorLabel={isMine ? "You" : author || "3xCodz team"}
                      createdAt={message.createdAt}
                      isClient={isMine}
                    />
                  );
                })
              )}
            </div>
          </SectionCard>

          {(ticket.attachments?.length ?? 0) > 0 ? (
            <SectionCard
              title="Attachments"
              description="Files shared on this ticket. Downloads use your portal sign-in."
            >
              <ul className="divide-y divide-white/5">
                {(ticket.attachments ?? []).map((attachment) => (
                  <li key={attachment.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{attachment.originalName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(attachment.size)} · {formatDateTime(attachment.createdAt)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void downloadAttachment(attachment)}
                      disabled={downloadingId === attachment.id}
                    >
                      {downloadingId === attachment.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {can("portal.tickets.update") ? (
            <SectionCard
              title="Reply"
              description={isClosed ? "This ticket is closed and can't receive new replies." : "Add an update or answer a question from the team."}
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const body = reply.trim();
                  if (body && canReply && !replyMutation.isPending) replyMutation.mutate(body);
                }}
                className="space-y-3"
              >
                <Textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  rows={4}
                  placeholder={isClosed ? "This ticket is closed." : "Type your reply..."}
                  disabled={!canReply || replyMutation.isPending}
                />
                <div className="flex justify-end">
                  <Button type="submit" disabled={!canReply || !reply.trim() || replyMutation.isPending}>
                    {replyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send reply
                  </Button>
                </div>
              </form>
            </SectionCard>
          ) : null}
        </div>

        <div className="space-y-4">
          <SectionCard title="Ticket details" contentClassName="space-y-4">
            <InfoList
              columns={1}
              items={[
                { label: "Ticket number", value: ticket.ticketNo },
                { label: "Category", value: humanize(ticket.category) },
                { label: "Priority", value: <StatusBadge status={ticket.priority} label={humanize(ticket.priority)} /> },
                { label: "Status", value: <StatusBadge status={ticket.status} /> },
                { label: "Opened", value: formatDateTime(ticket.createdAt) },
                { label: "Last activity", value: formatRelative(ticket.updatedAt) },
                { label: "Assigned to", value: personName(ticket.assignedTo) || <span className="text-muted-foreground">Not assigned yet</span> },
                { label: "Resolved", value: ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : "-" },
                { label: "Closed", value: ticket.closedAt ? formatDateTime(ticket.closedAt) : "-" },
              ]}
            />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

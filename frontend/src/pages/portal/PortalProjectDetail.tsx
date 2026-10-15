import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCircle2,
  Circle,
  Download,
  Flag,
  History,
  LayoutGrid,
  Loader2,
  Megaphone,
  Paperclip,
} from "lucide-react";
import { ApiError, api, downloadBlob } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { toastError } from "@/lib/errors";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { DetailHeader } from "@/components/common/DetailHeader";
import { InfoList, SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
  humanize,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChecklistItem, PersonRef, RevisionRequest } from "@/types";

/** Exact shapes returned by `GET /portal/projects/:id` (client-scoped). */
interface PortalMilestone {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  completedAt: string | null;
  status: string;
}

interface PortalUpdate {
  id: string;
  title: string | null;
  body: string;
  createdAt: string;
  author?: { firstName: string; lastName: string } | null;
}

interface PortalProjectActivity {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
}

interface PortalAttachment {
  id: string;
  projectId: string | null;
  originalName: string;
  size: number;
  createdAt: string;
}

interface PortalProjectDetail {
  id: string;
  projectNo: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  progress: number;
  currency: string;
  startDate: string | null;
  deadline: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  service: { name: string; category?: string | null } | null;
  milestones: PortalMilestone[];
  updates: PortalUpdate[];
  activity: PortalProjectActivity[];
  /** Optional: rendered when the API chooses to share revision requests. */
  revisions?: RevisionRequest[];
  /** Optional: only rendered when the API chooses to share them. */
  checklist?: ChecklistItem[];
  manager?: PersonRef | null;
  budget?: string;
}

function isNoAccess(error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : 0;
  return status === 403 || status === 404;
}

/* -------------------------------- Revisions -------------------------------- */

function RevisionList({ items }: { items: RevisionRequest[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-6 w-6" />}
        title="No revision requests"
        description="Change requests raised on this project will be tracked here."
      />
    );
  }

  return (
    <SectionCard title="Revision requests" description="Every change request raised on this project.">
      <div className="space-y-4">
        {items.map((revision) => (
          <div
            key={revision.id}
            className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{revision.title}</p>
              <StatusBadge status={revision.status} />
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {revision.description}
            </p>
            {revision.response ? (
              <div className="mt-2 rounded-md border border-white/5 bg-white/[0.03] p-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Response from the team
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{revision.response}</p>
              </div>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Raised {formatDateTime(revision.createdAt)}
              {revision.resolvedAt ? ` · Resolved ${formatDate(revision.resolvedAt)}` : ""}
            </p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function RevisionsTab({ projectId, revisions }: { projectId: string; revisions?: RevisionRequest[] }) {
  const query = useApiQuery<RevisionRequest[]>(
    [...qk.portal.project(projectId), "revisions"],
    `/projects/${projectId}/revisions`,
    undefined,
    { enabled: !revisions },
  );

  if (revisions) return <RevisionList items={revisions} />;
  if (query.isLoading) return <LoadingState label="Loading revision requests..." />;

  if (query.isError) {
    if (isNoAccess(query.error)) {
      return (
        <EmptyState
          icon={<History className="h-6 w-6" />}
          title="Revision history is not available here"
          description="Revision requests for this project are managed with your project team. Open a support ticket if you need the status of a change request."
        />
      );
    }
    return (
      <ErrorState
        title="We couldn't load revision requests"
        description={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return <RevisionList items={query.data ?? []} />;
}

/* ---------------------------------- Files ---------------------------------- */

function FilesTab({ projectId }: { projectId: string }) {
  const files = useApiList<PortalAttachment>(
    [...qk.portal.project(projectId), "attachments"],
    "/attachments",
    { limit: 200 },
  );
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const items = (files.data?.items ?? []).filter((file) => file.projectId === projectId);

  const handleDownload = async (file: PortalAttachment) => {
    setDownloadingId(file.id);
    try {
      // Downloads always travel through the authenticated API - never a static URL.
      const blob = await api.blob(`/attachments/${file.id}`, { download: "true" });
      downloadBlob(blob, file.originalName);
    } catch (error) {
      toastError(error, "This file could not be downloaded.");
    } finally {
      setDownloadingId(null);
    }
  };

  if (files.isLoading) return <LoadingState label="Loading files..." />;

  if (files.isError) {
    if (isNoAccess(files.error)) {
      return (
        <EmptyState
          icon={<Paperclip className="h-6 w-6" />}
          title="Files are not available"
          description="You don't have access to the files for this project."
        />
      );
    }
    return (
      <ErrorState
        title="We couldn't load your files"
        description={files.error instanceof Error ? files.error.message : undefined}
        onRetry={() => void files.refetch()}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Paperclip className="h-6 w-6" />}
        title="No shared files yet"
        description="Files and deliverables shared with you on this project will appear here."
      />
    );
  }

  return (
    <SectionCard title="Project files" description="Deliverables shared with your account.">
      <ul className="divide-y divide-white/5">
        {items.map((file) => (
          <li key={file.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{file.originalName}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size)} · Added {formatDate(file.createdAt)}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={downloadingId === file.id}
              onClick={() => void handleDownload(file)}
            >
              {downloadingId === file.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloadingId === file.id ? "Downloading..." : "Download"}
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/* ---------------------------------- Page ----------------------------------- */

export default function PortalProjectDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const [tab, setTab] = useState("overview");

  const project = useApiQuery<PortalProjectDetail>(
    qk.portal.project(id),
    `/portal/projects/${id}`,
    undefined,
    { enabled: Boolean(id) },
  );

  if (project.isLoading) {
    return (
      <div className="space-y-6">
        <LoadingState label="Loading project..." />
      </div>
    );
  }

  if (project.isError || !project.data) {
    const noAccess = isNoAccess(project.error);
    return (
      <div className="space-y-6">
        <DetailHeader backTo="/portal/projects" backLabel="Back to projects" title="Project" />
        <ErrorState
          title={noAccess ? "This project was not found or you don't have access" : "We couldn't load this project"}
          description={
            noAccess
              ? "The portal only shows projects belonging to your account. Check the link or pick a project from your list."
              : project.error instanceof Error
                ? project.error.message
                : "Please try again in a moment."
          }
          onRetry={noAccess ? undefined : () => void project.refetch()}
        />
      </div>
    );
  }

  const data = project.data;

  return (
    <div className="space-y-6">
      <DetailHeader
        backTo="/portal/projects"
        backLabel="Back to projects"
        title={data.name}
        subtitle={`${data.projectNo}${data.service ? ` · ${data.service.name}` : ""}`}
        badge={<StatusBadge status={data.status} />}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <LayoutGrid className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="milestones">
            <Flag className="h-4 w-4" />
            Milestones
          </TabsTrigger>
          <TabsTrigger value="updates">
            <Megaphone className="h-4 w-4" />
            Updates
          </TabsTrigger>
          <TabsTrigger value="revisions">
            <History className="h-4 w-4" />
            Revisions
          </TabsTrigger>
          <TabsTrigger value="files">
            <Paperclip className="h-4 w-4" />
            Files
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <SectionCard
            title="Description"
            empty={!data.description}
            emptyTitle="No description yet"
            emptyDescription="Your project manager will add the scope of work here."
          >
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{data.description}</p>
          </SectionCard>

          <SectionCard title="Project overview">
            <InfoList
              columns={2}
              items={[
                { label: "Status", value: <StatusBadge status={data.status} /> },
                { label: "Priority", value: <StatusBadge status={data.priority} /> },
                {
                  label: "Service",
                  value: data.service
                    ? `${data.service.name}${data.service.category ? ` · ${data.service.category}` : ""}`
                    : "-",
                },
                {
                  label: "Progress",
                  value: (
                    <div className="flex items-center gap-2">
                      <Progress value={data.progress} className="h-1.5 w-28" />
                      <span className="text-xs text-muted-foreground">{data.progress}%</span>
                    </div>
                  ),
                },
                ...(data.manager
                  ? [
                      {
                        label: "Manager",
                        value: `${data.manager.firstName} ${data.manager.lastName}`,
                      },
                    ]
                  : []),
                ...(data.budget
                  ? [{ label: "Budget", value: formatMoney(data.budget, data.currency) }]
                  : []),
                { label: "Start date", value: formatDate(data.startDate) },
                { label: "Deadline", value: formatDate(data.deadline) },
                { label: "Completed", value: formatDate(data.completedAt) },
                { label: "Last updated", value: formatRelative(data.updatedAt) },
              ]}
            />
          </SectionCard>

          {data.checklist && data.checklist.length > 0 ? (
            <SectionCard
              title="Checklist"
              description="Shared tasks and deliverables for this project."
            >
              <ul className="space-y-2">
                {data.checklist.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    {item.isDone ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className={cn(item.isDone && "text-muted-foreground line-through")}>
                      {item.title}
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </TabsContent>

        <TabsContent value="milestones">
          <SectionCard
            title="Milestones"
            description="Milestones your account has been given visibility of."
            empty={data.milestones.length === 0}
            emptyTitle="No milestones shared yet"
            emptyDescription="As we agree milestones on your project they will show up here."
          >
            <div className="space-y-3">
              {data.milestones.map((milestone) => (
                <div
                  key={milestone.id}
                  className="flex flex-col gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{milestone.title}</p>
                    {milestone.description ? (
                      <p className="text-xs text-muted-foreground">{milestone.description}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Due {formatDate(milestone.dueDate)}
                      {milestone.completedAt
                        ? ` · Completed ${formatDate(milestone.completedAt)}`
                        : ""}
                    </p>
                  </div>
                  <StatusBadge status={milestone.status} />
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="updates" className="space-y-4">
          <SectionCard
            title="Project updates"
            description="Progress reports and notes shared with you."
            empty={data.updates.length === 0}
            emptyTitle="No updates yet"
            emptyDescription="When we post an update on your project you'll find it here."
          >
            <div className="space-y-4">
              {data.updates.map((update) => (
                <article
                  key={update.id}
                  className="space-y-1.5 border-b border-white/5 pb-4 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-medium">{update.title ?? "Project update"}</h4>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(update.createdAt)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{update.body}</p>
                  {update.author ? (
                    <p className="text-xs text-muted-foreground">
                      By {update.author.firstName} {update.author.lastName}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Activity"
            description="Client-visible activity recorded against this project."
            empty={data.activity.length === 0}
            emptyTitle="No activity yet"
            emptyDescription="Recorded actions on your project will be listed here."
          >
            <div className="space-y-3">
              {data.activity.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-sky-400 to-violet-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{entry.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {humanize(entry.action)} · {formatRelative(entry.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="revisions">
          <RevisionsTab projectId={data.id} revisions={data.revisions} />
        </TabsContent>

        <TabsContent value="files">
          <FilesTab projectId={data.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import {
  Coins,
  Flag,
  LayoutGrid,
  ListChecks,
  ListTodo,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { clientDisplayName, formatDate, formatMoney, formatRelative, initials, toNumber } from "@/lib/format";
import { OPTIONS, statusLabel } from "@/lib/status";
import type {
  ChecklistItem,
  Milestone,
  PersonRef,
  Project,
  ProjectFinancials,
  ProjectMember,
  ProjectUpdate,
  RevisionRequest,
  Task,
} from "@/types";
import { DetailHeader } from "@/components/common/DetailHeader";
import { SectionCard, InfoList } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { StatCard } from "@/components/common/StatCard";
import { SwitchField, TextField, TextareaField } from "@/components/common/form";
import { ProjectDialog } from "@/pages/projects/ProjectList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* --------------------------------- Tabs ----------------------------------- */

function OverviewTab({ project }: { project: Project }) {
  const infoItems = [
    { label: "Client", value: clientDisplayName(project.client) },
    { label: "Service", value: project.service?.name ?? "-" },
    {
      label: "Manager",
      value: project.manager ? `${project.manager.firstName} ${project.manager.lastName}` : "-",
    },
    { label: "Status", value: <StatusBadge status={project.status} /> },
    { label: "Priority", value: <StatusBadge status={project.priority} /> },
    { label: "Budget", value: formatMoney(project.budget, project.currency) },
    {
      label: "Estimated hours",
      value: project.estimatedHours ? `${toNumber(project.estimatedHours)} h` : "-",
    },
    { label: "Start date", value: formatDate(project.startDate) },
    { label: "Deadline", value: formatDate(project.deadline) },
    { label: "Created", value: formatDate(project.createdAt) },
    { label: "Tags", value: project.tags && project.tags.length ? project.tags.join(", ") : "-", full: true },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard className="lg:col-span-2" title="Details" description="Commercial and delivery information.">
          <InfoList items={infoItems} columns={2} />
        </SectionCard>

        <SectionCard title="Progress">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-2xl font-semibold tracking-tight">{project.progress}%</p>
              <Progress value={project.progress} />
              <p className="text-xs text-muted-foreground">Overall completion.</p>
            </div>
            <Separator />
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Tasks</dt>
                <dd>{project._count?.tasks ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Invoices</dt>
                <dd>{project._count?.invoices ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Updates</dt>
                <dd>{project._count?.updates ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Revision requests</dt>
                <dd>{project._count?.revisions ?? 0}</dd>
              </div>
            </dl>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Description"
        empty={!project.description}
        emptyTitle="No description yet"
        emptyDescription="Edit the project to add a description."
      >
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{project.description}</p>
      </SectionCard>

      <SectionCard
        title="Internal notes"
        description="Only visible to the internal team."
        empty={!project.internalNotes}
        emptyTitle="No internal notes"
        emptyDescription="Edit the project to record internal notes."
      >
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{project.internalNotes}</p>
      </SectionCard>
    </div>
  );
}

function MilestonesTab({ id, milestones, canUpdate }: { id: string; milestones: Milestone[]; canUpdate: boolean }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.detail("projects", id) });

  const addMutation = useMutation({
    mutationFn: () => api.post(`/projects/${id}/milestones`, { title: title.trim(), dueDate: dueDate || undefined }),
    onSuccess: () => {
      toastSuccess("Milestone added");
      setTitle("");
      setDueDate("");
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { milestoneId: string; status: string }) =>
      api.patch(`/projects/${id}/milestones/${vars.milestoneId}`, { status: vars.status }),
    onSuccess: () => {
      toastSuccess("Milestone updated");
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const deleteMutation = useMutation({
    mutationFn: (milestoneId: string) => api.del(`/projects/${id}/milestones/${milestoneId}`),
    onSuccess: () => {
      toastSuccess("Milestone removed");
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  return (
    <SectionCard title="Milestones" description="Plan the delivery phases and track client-visible progress.">
      <div className="space-y-4">
        {canUpdate ? (
          <form
            className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim()) addMutation.mutate();
            }}
          >
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Milestone title"
              className="flex-1"
              aria-label="Milestone title"
            />
            <Input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="sm:w-44"
              aria-label="Due date"
            />
            <Button type="submit" disabled={!title.trim() || addMutation.isPending}>
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </form>
        ) : null}

        {milestones.length === 0 ? (
          <EmptyState
            title="No milestones yet"
            description={canUpdate ? "Add the first milestone above." : "Nothing has been planned yet."}
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-white/5">
            {milestones.map((milestone) => (
              <li key={milestone.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{milestone.title}</p>
                    {!milestone.isClientVisible ? <Badge variant="muted">Internal</Badge> : null}
                  </div>
                  {milestone.description ? (
                    <p className="text-xs text-muted-foreground">{milestone.description}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">Due {formatDate(milestone.dueDate)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canUpdate ? (
                    <Select
                      value={milestone.status}
                      onValueChange={(status) => statusMutation.mutate({ milestoneId: milestone.id, status })}
                    >
                      <SelectTrigger className="h-9 w-40" aria-label={`Status for ${milestone.title}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPTIONS.milestoneStatus.map((status) => (
                          <SelectItem key={status} value={status}>
                            {statusLabel(status)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <StatusBadge status={milestone.status} />
                  )}
                  {canUpdate ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-rose-300 hover:text-rose-200"
                      aria-label={`Delete ${milestone.title}`}
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(milestone.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

function ChecklistTab({ id, items, canUpdate }: { id: string; items: ChecklistItem[]; canUpdate: boolean }) {
  const [title, setTitle] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.detail("projects", id) });

  const addMutation = useMutation({
    mutationFn: () => api.post(`/projects/${id}/checklist`, { title: title.trim() }),
    onSuccess: () => {
      toastSuccess("Checklist item added");
      setTitle("");
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { itemId: string; isDone: boolean }) =>
      api.patch(`/projects/${id}/checklist/${vars.itemId}`, { isDone: vars.isDone }),
    onSuccess: () => invalidate(),
    onError: (error) => toastError(error),
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => api.del(`/projects/${id}/checklist/${itemId}`),
    onSuccess: () => {
      toastSuccess("Checklist item removed");
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const doneCount = items.filter((item) => item.isDone).length;

  return (
    <SectionCard title="Checklist" description="A lightweight definition of done for this project.">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Progress value={items.length ? (doneCount / items.length) * 100 : 0} className="h-1.5 flex-1" />
          <span className="shrink-0 text-xs text-muted-foreground">
            {doneCount} of {items.length} done
          </span>
        </div>

        {canUpdate ? (
          <form
            className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim()) addMutation.mutate();
            }}
          >
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Add a checklist item..."
              className="flex-1"
              aria-label="Checklist item"
            />
            <Button type="submit" disabled={!title.trim() || addMutation.isPending}>
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </form>
        ) : null}

        {items.length === 0 ? (
          <EmptyState title="Nothing on the checklist" description="Items added here help track delivery quality." className="py-10" />
        ) : (
          <ul className="divide-y divide-white/5">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <Checkbox
                    checked={item.isDone}
                    disabled={!canUpdate || toggleMutation.isPending}
                    onCheckedChange={(checked) => toggleMutation.mutate({ itemId: item.id, isDone: checked === true })}
                  />
                  <span className={`truncate text-sm ${item.isDone ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {item.title}
                  </span>
                </label>
                {canUpdate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-rose-300 hover:text-rose-200"
                    aria-label={`Remove ${item.title}`}
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

function MembersTab({ id, members, canAssign }: { id: string; members: ProjectMember[]; canAssign: boolean }) {
  const [selected, setSelected] = useState("");
  const assignable = useApiQuery<PersonRef[]>(["users", "assignable"], "/users/assignable", undefined, {
    enabled: canAssign,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.detail("projects", id) });

  const addMutation = useMutation({
    mutationFn: () => api.post(`/projects/${id}/members`, { userId: selected }),
    onSuccess: () => {
      toastSuccess("Member added");
      setSelected("");
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.del(`/projects/${id}/members/${userId}`),
    onSuccess: () => {
      toastSuccess("Member removed");
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const memberIds = new Set(members.map((member) => member.userId));
  const addableOptions = (assignable.data ?? [])
    .filter((user) => !memberIds.has(user.id))
    .map((user) => ({ value: user.id, label: `${user.firstName} ${user.lastName}${user.jobTitle ? ` · ${user.jobTitle}` : ""}` }));

  return (
    <SectionCard title="Team" description="Members with access to this project.">
      <div className="space-y-4">
        {canAssign ? (
          <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 sm:flex-row sm:items-center">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="flex-1" aria-label="Choose a member to add">
                <SelectValue placeholder={assignable.isLoading ? "Loading directory..." : "Choose a user..."} />
              </SelectTrigger>
              <SelectContent>
                {addableOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={!selected || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add member
            </Button>
            {assignable.isError ? (
              <p className="text-xs text-muted-foreground">The user directory could not be loaded (requires users.view).</p>
            ) : null}
          </div>
        ) : null}

        {members.length === 0 ? (
          <EmptyState title="No members yet" description={canAssign ? "Add the people working on this project." : "No one has been assigned."} className="py-10" />
        ) : (
          <ul className="divide-y divide-white/5">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-medium">
                    {initials(member.user?.firstName, member.user?.lastName)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {member.user ? `${member.user.firstName} ${member.user.lastName}` : member.userId}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.user?.jobTitle || member.user?.email || ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {member.role ? <Badge variant="muted">{member.role}</Badge> : null}
                  {canAssign ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-rose-300 hover:text-rose-200"
                      aria-label="Remove member"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(member.userId)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

const updateSchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().trim().min(1, "Write the update before posting").max(10000),
  isClientVisible: z.boolean(),
});

type UpdateFormValues = z.infer<typeof updateSchema>;

function UpdatesTab({ id, canUpdate }: { id: string; canUpdate: boolean }) {
  const updates = useApiQuery<ProjectUpdate[]>(["projects", "updates", id], `/projects/${id}/updates`);
  const form = useForm<UpdateFormValues>({
    resolver: zodResolver(updateSchema),
    defaultValues: { title: "", body: "", isClientVisible: true },
  });

  const postMutation = useMutation({
    mutationFn: (values: UpdateFormValues) =>
      api.post(`/projects/${id}/updates`, {
        title: values.title?.trim() || undefined,
        body: values.body.trim(),
        isClientVisible: values.isClientVisible,
      }),
    onSuccess: () => {
      toastSuccess("Update posted");
      form.reset({ title: "", body: "", isClientVisible: true });
      queryClient.invalidateQueries({ queryKey: ["projects", "updates"] });
      queryClient.invalidateQueries({ queryKey: ["projects", "detail", id] });
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) form.setError(key as keyof UpdateFormValues, { message });
      toastError(error);
    },
  });

  return (
    <div className="space-y-4">
      {canUpdate ? (
        <SectionCard title="Post an update" description="Share progress with the team and, optionally, the client.">
          <form onSubmit={form.handleSubmit((values) => postMutation.mutate(values))} className="space-y-4" noValidate>
            <TextField form={form} name="title" label="Title" placeholder="Week 2 delivery update" />
            <TextareaField form={form} name="body" label="Update" rows={4} required placeholder="What changed since the last update?" />
            <SwitchField
              form={form}
              name="isClientVisible"
              label="Visible to the client"
              description="Client-visible updates appear in the portal."
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={postMutation.isPending}>
                {postMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Post update
              </Button>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <SectionCard title="Update history">
        {updates.isLoading ? (
          <LoadingState label="Loading updates..." />
        ) : updates.isError ? (
          <ErrorState
            description={updates.error instanceof Error ? updates.error.message : "Updates could not be loaded."}
            onRetry={() => updates.refetch()}
          />
        ) : !updates.data || updates.data.length === 0 ? (
          <EmptyState title="No updates yet" description="Posted updates will appear here." className="py-10" />
        ) : (
          <ul className="space-y-4">
            {updates.data.map((update) => (
              <li key={update.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{update.title || "Project update"}</p>
                    <Badge variant={update.isClientVisible ? "info" : "muted"}>
                      {update.isClientVisible ? "Client visible" : "Internal"}
                    </Badge>
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {update.author ? `${update.author.firstName} ${update.author.lastName} · ` : ""}
                    {formatRelative(update.createdAt)}
                  </p>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{update.body}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

const revisionSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().min(1, "Describe the requested revision").max(5000),
});

type RevisionFormValues = z.infer<typeof revisionSchema>;

function RevisionsTab({ id, canUpdate }: { id: string; canUpdate: boolean }) {
  const revisions = useApiQuery<RevisionRequest[]>(["projects", "revisions", id], `/projects/${id}/revisions`);
  const [createOpen, setCreateOpen] = useState(false);
  const form = useForm<RevisionFormValues>({ resolver: zodResolver(revisionSchema), defaultValues: { title: "", description: "" } });

  const createMutation = useMutation({
    mutationFn: (values: RevisionFormValues) => api.post(`/projects/${id}/revisions`, values),
    onSuccess: () => {
      toastSuccess("Revision requested");
      form.reset({ title: "", description: "" });
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["projects", "revisions"] });
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) form.setError(key as keyof RevisionFormValues, { message });
      toastError(error);
    },
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { revisionId: string; status: string }) =>
      api.patch(`/projects/${id}/revisions/${vars.revisionId}`, { status: vars.status }),
    onSuccess: (_data, vars) => {
      toastSuccess(vars.status === "RESOLVED" ? "Revision resolved" : "Revision rejected");
      queryClient.invalidateQueries({ queryKey: ["projects", "revisions"] });
    },
    onError: (error) => toastError(error),
  });

  return (
    <SectionCard
      title="Revision requests"
      description="Client feedback rounds requested against this project."
      actions={
        canUpdate ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New request
          </Button>
        ) : null
      }
    >
      {revisions.isLoading ? (
        <LoadingState label="Loading revisions..." />
      ) : revisions.isError ? (
        <ErrorState
          description={revisions.error instanceof Error ? revisions.error.message : "Revisions could not be loaded."}
          onRetry={() => revisions.refetch()}
        />
      ) : !revisions.data || revisions.data.length === 0 ? (
        <EmptyState title="No revision requests" description="Everything is on track - no rounds requested." className="py-10" />
      ) : (
        <ul className="space-y-3">
          {revisions.data.map((revision) => (
            <li key={revision.id} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-foreground">{revision.title}</p>
                <StatusBadge status={revision.status} />
              </div>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{revision.description}</p>
              {revision.response ? (
                <p className="rounded-lg border border-white/10 bg-white/5 p-2 text-xs text-muted-foreground">
                  Response: {revision.response}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Requested {formatRelative(revision.createdAt)}
                  {revision.resolvedAt ? ` · Closed ${formatDate(revision.resolvedAt)}` : ""}
                </p>
                {canUpdate && !["RESOLVED", "REJECTED"].includes(revision.status) ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ revisionId: revision.id, status: "RESOLVED" })}
                    >
                      Resolve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ revisionId: revision.id, status: "REJECTED" })}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New revision request</DialogTitle>
            <DialogDescription>Describe the round of changes needed on this project.</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((values) => createMutation.mutate(values))} className="space-y-4" noValidate>
            <TextField form={form} name="title" label="Title" required placeholder="Homepage hero adjustments" />
            <TextareaField form={form} name="description" label="Description" rows={4} required placeholder="What needs to change and why?" />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

function FinancialsTab({ id }: { id: string }) {
  const financials = useApiQuery<ProjectFinancials>(["projects", "financials", id], `/projects/${id}/financials`);

  if (financials.isLoading) return <LoadingState label="Loading financials..." />;
  if (financials.isError || !financials.data) {
    return (
      <ErrorState
        description={financials.error instanceof Error ? financials.error.message : "Financials could not be loaded."}
        onRetry={() => financials.refetch()}
      />
    );
  }

  const data = financials.data;
  const currency = data.project?.currency ?? "LKR";
  const margin = Number(data.marginPercent ?? 0);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Invoiced revenue" value={formatMoney(data.invoicedRevenue, currency)} tone="primary" hint="Issued & paid invoices" />
      <StatCard label="Cash received" value={formatMoney(data.cashReceived, currency)} tone="success" hint="Confirmed payments" />
      <StatCard label="Expenses" value={formatMoney(data.expenses, currency)} tone="warning" hint="Approved & paid spend" />
      <StatCard label="Profit" value={formatMoney(data.profit, currency)} tone="accent" hint={`Margin ${margin.toFixed(1)}%`} />
    </div>
  );
}

function TasksTab({ projectId }: { projectId: string }) {
  const { can } = useAuth();
  const canView = can("tasks.view");
  const tasks = useApiList<Task>(
    qk.list("tasks", { projectId, limit: 50 }),
    "/tasks",
    { projectId, limit: 50 },
    { enabled: canView },
  );

  return (
    <SectionCard
      title="Project tasks"
      description="Tasks linked to this project."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to={`/tasks?projectId=${projectId}`}>Open in tasks</Link>
        </Button>
      }
    >
      {!canView ? (
        <EmptyState title="No access" description="You do not have permission to view tasks." className="py-10" />
      ) : tasks.isLoading ? (
        <LoadingState label="Loading tasks..." />
      ) : tasks.isError ? (
        <ErrorState
          description={tasks.error instanceof Error ? tasks.error.message : "Tasks could not be loaded."}
          onRetry={() => tasks.refetch()}
        />
      ) : (tasks.data?.items ?? []).length === 0 ? (
        <EmptyState title="No tasks yet" description="Tasks created for this project will show up here." className="py-10" />
      ) : (
        <ul className="divide-y divide-white/5">
          {tasks.data?.items.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  {task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : "Unassigned"} · Due{" "}
                  {formatDate(task.dueDate)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={task.priority} />
                <StatusBadge status={task.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------- Main screen ------------------------------- */

export default function ProjectDetail() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);

  const project = useApiQuery<Project>(qk.detail("projects", id), `/projects/${id}`, undefined, {
    enabled: Boolean(id),
  });

  if (project.isLoading) {
    return (
      <div className="space-y-6">
        <LoadingState label="Loading project..." />
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <div className="space-y-6">
        <ErrorState
          title="Project not found"
          description={project.error instanceof Error ? project.error.message : "This project could not be loaded."}
          onRetry={() => project.refetch()}
        />
      </div>
    );
  }

  const data = project.data;
  const canUpdate = can("projects.update");
  const showFinance = can("finance.view");

  return (
    <div className="space-y-6">
      <DetailHeader
        backTo="/projects"
        backLabel="All projects"
        title={`${data.projectNo} · ${data.name}`}
        badge={
          <>
            <StatusBadge status={data.status} />
            <StatusBadge status={data.priority} />
          </>
        }
        subtitle={
          <span>
            {clientDisplayName(data.client)}
            {data.manager ? ` · Manager ${data.manager.firstName} ${data.manager.lastName}` : ""}
          </span>
        }
        actions={
          canUpdate ? (
            <Button type="button" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          ) : null
        }
      >
        <div className="max-w-md space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Overall progress</span>
            <span className="font-medium text-foreground">{data.progress}%</span>
          </div>
          <Progress value={data.progress} />
        </div>
      </DetailHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="overview">
            <LayoutGrid />
            Overview
          </TabsTrigger>
          <TabsTrigger value="milestones">
            <Flag />
            Milestones
          </TabsTrigger>
          <TabsTrigger value="checklist">
            <ListChecks />
            Checklist
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users />
            Members
          </TabsTrigger>
          <TabsTrigger value="updates">
            <MessageSquare />
            Updates
          </TabsTrigger>
          <TabsTrigger value="revisions">
            <RotateCcw />
            Revisions
          </TabsTrigger>
          {showFinance ? (
            <TabsTrigger value="finance">
              <Coins />
              Financials
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="tasks">
            <ListTodo />
            Tasks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab project={data} />
        </TabsContent>
        <TabsContent value="milestones">
          <MilestonesTab id={data.id} milestones={data.milestones ?? []} canUpdate={canUpdate} />
        </TabsContent>
        <TabsContent value="checklist">
          <ChecklistTab id={data.id} items={data.checklist ?? []} canUpdate={canUpdate} />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab id={data.id} members={data.members ?? []} canAssign={can("projects.assign")} />
        </TabsContent>
        <TabsContent value="updates">
          <UpdatesTab id={data.id} canUpdate={canUpdate} />
        </TabsContent>
        <TabsContent value="revisions">
          <RevisionsTab id={data.id} canUpdate={canUpdate} />
        </TabsContent>
        {showFinance ? (
          <TabsContent value="finance">
            <FinancialsTab id={data.id} />
          </TabsContent>
        ) : null}
        <TabsContent value="tasks">
          <TasksTab projectId={data.id} />
        </TabsContent>
      </Tabs>

      {editOpen ? (
        <ProjectDialog project={data} open={editOpen} onOpenChange={setEditOpen} />
      ) : null}
    </div>
  );
}

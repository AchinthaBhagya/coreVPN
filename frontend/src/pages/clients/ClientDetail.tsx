import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Archive,
  Briefcase,
  FileText,
  LifeBuoy,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
} from "lucide-react";

import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiQuery } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { clientDisplayName, formatDateTime, formatRelative, humanize } from "@/lib/format";
import { DetailHeader } from "@/components/common/DetailHeader";
import { InfoList, SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { StatCard } from "@/components/common/StatCard";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState, LoadingState } from "@/components/common/states";
import { CheckboxField, TextField } from "@/components/common/form";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ClientFormDialog, type AssignableUser } from "@/pages/clients/ClientList";
import type { ActivityEntry, Client, ClientContact, ClientNote } from "@/types";

const contactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.union([z.literal(""), z.string().email("Enter a valid email address")]),
  phone: z.string().trim().max(40, "Phone is too long"),
  position: z.string().trim().max(120, "Position is too long"),
  isPrimary: z.boolean(),
});

type ContactValues = z.infer<typeof contactSchema>;

const EMPTY_CONTACT_VALUES: ContactValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  position: "",
  isPrimary: false,
};

function toContactPayload(values: ContactValues) {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email === "" ? null : values.email,
    phone: values.phone.trim() === "" ? null : values.phone.trim(),
    position: values.position.trim() === "" ? null : values.position.trim(),
    isPrimary: values.isPrimary,
  };
}

/** Create/edit dialog for a client contact (POST + PATCH on the client detail routes). */
function ContactDialog({
  open,
  onOpenChange,
  clientId,
  contact,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  contact: ClientContact | null;
  onSaved: () => void;
}) {
  const form = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: EMPTY_CONTACT_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      contact
        ? {
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email ?? "",
            phone: contact.phone ?? "",
            position: contact.position ?? "",
            isPrimary: contact.isPrimary,
          }
        : EMPTY_CONTACT_VALUES,
    );
  }, [open, contact, form]);

  const mutation = useMutation({
    mutationFn: (values: ContactValues) => {
      const payload = toContactPayload(values);
      return contact
        ? api.patch(`/clients/${clientId}/contacts/${contact.id}`, payload)
        : api.post(`/clients/${clientId}/contacts`, payload);
    },
    onSuccess: () => {
      toastSuccess(contact ? "Contact updated" : "Contact added");
      onSaved();
      onOpenChange(false);
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        form.setError(key as keyof ContactValues, { message });
      }
      toastError(error);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>
            A person at this client you can address projects, invoices and tickets to.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="firstName" label="First name" required />
            <TextField form={form} name="lastName" label="Last name" required />
            <TextField form={form} name="email" label="Email" type="email" />
            <TextField form={form} name="phone" label="Phone" />
            <TextField form={form} name="position" label="Position" placeholder="e.g. Finance Manager" />
          </div>
          <CheckboxField form={form} name="isPrimary" label="Primary contact" description="Mark this person as the main point of contact." />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {contact ? "Save changes" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ClientContact | null>(null);
  const [deletingContact, setDeletingContact] = useState<ClientContact | null>(null);
  const [deletingNote, setDeletingNote] = useState<ClientNote | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [noteInternal, setNoteInternal] = useState(true);

  const detail = useApiQuery<Client>(qk.detail("clients", id), `/clients/${id}`, undefined, {
    enabled: Boolean(id),
  });
  const assignable = useQuery<AssignableUser[]>({
    queryKey: ["users", "assignable"],
    queryFn: () => api.get<AssignableUser[]>("/users/assignable"),
    retry: false,
  });
  const activity = useApiQuery<ActivityEntry[]>(["clients", "activity", id], `/clients/${id}/activity`, undefined, {
    enabled: Boolean(id) && tab === "activity",
  });

  const invalidateClients = () => {
    queryClient.invalidateQueries({ queryKey: ["clients"] });
  };

  const archiveMutation = useMutation({
    mutationFn: () => api.del<void>(`/clients/${id}`),
    onSuccess: () => {
      toastSuccess("Client archived", "The client was moved out of the active list.");
      navigate("/clients");
    },
    onError: (error) => toastError(error),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.del<void>(`/clients/${id}/permanent`),
    onSuccess: () => {
      toastSuccess("Client deleted", "The client has been permanently deleted.");
      navigate("/clients");
    },
    onError: (error) => toastError(error),
  });

  const addNoteMutation = useMutation({
    mutationFn: () =>
      api.post(`/clients/${id}/notes`, { body: noteBody.trim(), isInternal: noteInternal }),
    onSuccess: () => {
      toastSuccess("Note added");
      setNoteBody("");
      setNoteInternal(true);
      invalidateClients();
    },
    onError: (error) => toastError(error),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => api.del<void>(`/clients/${id}/notes/${noteId}`),
    onSuccess: () => {
      toastSuccess("Note deleted");
      setDeletingNote(null);
      invalidateClients();
    },
    onError: (error) => toastError(error),
  });

  const deleteContactMutation = useMutation({
    mutationFn: (contactId: string) => api.del<void>(`/clients/${id}/contacts/${contactId}`),
    onSuccess: () => {
      toastSuccess("Contact removed");
      setDeletingContact(null);
      invalidateClients();
    },
    onError: (error) => toastError(error),
  });

  if (detail.isLoading) return <LoadingState label="Loading client..." />;
  if (detail.isError || !detail.data) {
    return (
      <ErrorState
        description={detail.error instanceof Error ? detail.error.message : "This client could not be loaded."}
        onRetry={() => detail.refetch()}
      />
    );
  }

  const client = detail.data;
  const contacts = client.contacts ?? [];
  const notes = client.notesList ?? [];
  const counts = client._count;
  const manager = (assignable.data ?? []).find((user) => user.id === client.accountManagerId) ?? null;

  const openContactDialog = (contact: ClientContact | null) => {
    setEditingContact(contact);
    setContactDialogOpen(true);
  };

  const overviewItems = [
    { label: "Type", value: humanize(client.type) },
    { label: "Status", value: <StatusBadge status={client.status} /> },
    {
      label: "Email",
      value: (
        <a href={`mailto:${client.email}`} className="text-primary hover:underline">
          {client.email}
        </a>
      ),
    },
    { label: "Phone", value: client.phone || "-" },
    { label: "Company", value: client.companyName || "-" },
    { label: "Website", value: client.website || "-" },
    { label: "City", value: client.city || "-" },
    { label: "Country", value: client.country || "-" },
    { label: "Tax ID", value: client.taxId || "-" },
    { label: "Currency", value: client.currency },
    { label: "Lead source", value: client.leadSource || "-" },
    { label: "Account manager", value: manager ? `${manager.firstName} ${manager.lastName}` : "-" },
    { label: "Created", value: formatDateTime(client.createdAt) },
    { label: "Updated", value: formatDateTime(client.updatedAt) },
    { label: "Address", value: client.address || "-", full: true },
    { label: "Internal notes", value: client.notes || "-", full: true },
  ];

  return (
    <div className="space-y-6">
      <DetailHeader
        backTo="/clients"
        backLabel="Clients"
        title={clientDisplayName(client)}
        subtitle={
          client.companyName
            ? `${client.email} · ${client.companyName}`
            : client.email
        }
        badge={<StatusBadge status={client.status} />}
        actions={
          <>
            {can("clients.update") ? (
              <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            ) : null}
            {can("clients.delete") ? (
              <>
                <Button type="button" variant="outline" onClick={() => setArchiveOpen(true)}>
                  <Archive className="h-4 w-4" />
                  Archive
                </Button>
                <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4" />
                  Delete permanently
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
          <TabsTrigger value="notes">Notes ({notes.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* ------------------------------- Overview ------------------------------ */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Projects"
              value={counts?.projects ?? 0}
              icon={<Briefcase className="h-5 w-5" />}
            />
            <StatCard
              label="Invoices"
              value={counts?.invoices ?? 0}
              icon={<ReceiptText className="h-5 w-5" />}
              tone="success"
            />
            <StatCard
              label="Tickets"
              value={counts?.tickets ?? 0}
              icon={<LifeBuoy className="h-5 w-5" />}
              tone="warning"
            />
            <StatCard
              label="Quotations"
              value={counts?.quotations ?? 0}
              icon={<FileText className="h-5 w-5" />}
              tone="accent"
            />
          </div>

          <SectionCard title="Profile" description="Core details and account information.">
            <InfoList items={overviewItems} columns={3} />
          </SectionCard>
        </TabsContent>

        {/* ------------------------------- Contacts ------------------------------ */}
        <TabsContent value="contacts" className="space-y-4">
          <SectionCard
            title="Contacts"
            description="People at this client we work with."
            actions={
              can("clients.update") ? (
                <Button type="button" size="sm" onClick={() => openContactDialog(null)}>
                  <Plus className="h-4 w-4" />
                  Add contact
                </Button>
              ) : undefined
            }
            empty={contacts.length === 0}
            emptyTitle="No contacts yet"
            emptyDescription={
              can("clients.update")
                ? "Add the people at this client so projects and invoices can be addressed to them."
                : "No contacts have been added to this client."
            }
            emptyAction={
              can("clients.update") ? (
                <Button type="button" size="sm" onClick={() => openContactDialog(null)}>
                  <Plus className="h-4 w-4" />
                  Add contact
                </Button>
              ) : undefined
            }
          >
            <ul className="divide-y divide-border/70">
              {contacts.map((contact) => (
                <li key={contact.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                      {contact.firstName} {contact.lastName}
                      {contact.isPrimary ? <Badge variant="info">Primary</Badge> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{contact.position || "-"}</p>
                    <p className="text-xs text-muted-foreground">
                      {[contact.email, contact.phone].filter(Boolean).join(" · ") || "-"}
                    </p>
                  </div>
                  {can("clients.update") ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Edit contact"
                        onClick={() => openContactDialog(contact)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-danger hover:text-danger/80"
                        title="Remove contact"
                        onClick={() => setDeletingContact(contact)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </SectionCard>
        </TabsContent>

        {/* -------------------------------- Notes -------------------------------- */}
        <TabsContent value="notes" className="space-y-4">
          {can("clients.update") ? (
            <SectionCard title="Add a note" description="Notes are private to your team by default.">
              <div className="space-y-3">
                <Textarea
                  rows={3}
                  value={noteBody}
                  onChange={(event) => setNoteBody(event.target.value)}
                  placeholder="Write a note about this client..."
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={noteInternal}
                      onCheckedChange={(checked) => setNoteInternal(checked === true)}
                    />
                    Internal only
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => addNoteMutation.mutate()}
                    disabled={!noteBody.trim() || addNoteMutation.isPending}
                  >
                    {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add note
                  </Button>
                </div>
              </div>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Notes"
            description={`${notes.length} note${notes.length === 1 ? "" : "s"} on this client.`}
            empty={notes.length === 0}
            emptyTitle="No notes yet"
            emptyDescription="Context you record here stays with the client record."
          >
            <ul className="divide-y divide-border/70">
              {notes.map((note) => (
                <li key={note.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 space-y-1">
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground">{note.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(note.createdAt)} · {formatRelative(note.createdAt)}
                      {note.isInternal ? " · Internal" : " · Client visible"}
                    </p>
                  </div>
                  {can("clients.update") ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-danger hover:text-danger/80"
                      title="Delete note"
                      onClick={() => setDeletingNote(note)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </SectionCard>
        </TabsContent>

        {/* ------------------------------- Activity ------------------------------ */}
        <TabsContent value="activity">
          {activity.isLoading ? (
            <LoadingState label="Loading activity..." />
          ) : activity.isError ? (
            <ErrorState
              description={
                activity.error instanceof Error ? activity.error.message : "Activity could not be loaded."
              }
              onRetry={() => activity.refetch()}
            />
          ) : (activity.data ?? []).length === 0 ? (
            <SectionCard
              title="Activity"
              description="Recent changes across this client record."
              empty
              emptyTitle="No activity yet"
              emptyDescription="Changes to this client and its records will show up here."
            />
          ) : (
            <ul className="space-y-3">
              {(activity.data ?? []).map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 p-3"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-primary to-primary/40" />
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm text-foreground">{entry.summary}</p>
                      <p className="text-xs text-muted-foreground">
                        {humanize(entry.action)} ·{" "}
                        {entry.actor ? `${entry.actor.firstName} ${entry.actor.lastName}` : "System"} ·{" "}
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Badge variant="muted">{humanize(entry.entityType)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <ClientFormDialog open={editOpen} onOpenChange={setEditOpen} client={client} />

      <ContactDialog
        open={contactDialogOpen}
        onOpenChange={(open) => {
          setContactDialogOpen(open);
          if (!open) setEditingContact(null);
        }}
        clientId={id}
        contact={editingContact}
        onSaved={invalidateClients}
      />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive client?"
        description={`${clientDisplayName(client)} will be archived and removed from the active client list.`}
        confirmLabel="Archive client"
        destructive
        loading={archiveMutation.isPending}
        onConfirm={() => archiveMutation.mutate()}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete client permanently?"
        description={`${clientDisplayName(client)} will be permanently deleted. This action cannot be undone.`}
        confirmLabel="Delete permanently"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />

      <ConfirmDialog
        open={Boolean(deletingContact)}
        onOpenChange={(open) => {
          if (!open) setDeletingContact(null);
        }}
        title="Remove contact?"
        description={
          deletingContact
            ? `${deletingContact.firstName} ${deletingContact.lastName} will be removed from this client.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={deleteContactMutation.isPending}
        onConfirm={() => {
          if (deletingContact) deleteContactMutation.mutate(deletingContact.id);
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingNote)}
        onOpenChange={(open) => {
          if (!open) setDeletingNote(null);
        }}
        title="Delete note?"
        description="This note will be permanently removed."
        confirmLabel="Delete"
        destructive
        loading={deleteNoteMutation.isPending}
        onConfirm={() => {
          if (deletingNote) deleteNoteMutation.mutate(deletingNote.id);
        }}
      />
    </div>
  );
}

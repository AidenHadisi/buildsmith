import { skipToken, useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { api, type TaskDetail } from "./api.ts";
import { Markdown } from "./Markdown.tsx";
import { StageBadge } from "./StageBadge.tsx";
import { useTaskParam } from "./useTaskParam.ts";

type Doc = TaskDetail["spec"] | TaskDetail["verification"];
type Slice = TaskDetail["slices"][number];
type Note = TaskDetail["notes"][number];

export function TaskSheet() {
  const [id, setTaskId] = useTaskParam();
  const { data, error } = useQuery({
    queryKey: ["task", id],
    queryFn: id ? () => parseResponse(api.api.tasks[":id"].$get({ param: { id } })) : skipToken,
  });

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) setTaskId(null);
      }}
    >
      <SheetContent
        side="right"
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        {error && <p className="p-4">{error.message}</p>}
        {data && <SheetBody data={data} />}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ data }: { data: TaskDetail }) {
  const verification = data.verification?.kind === "verification" ? data.verification : null;
  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <SheetTitle>{data.task.title}</SheetTitle>
          <StageBadge stage={data.next.stage} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-mono">{data.task.id.slice(-6)}</span>
          {data.task.branch && <LinkOrText value={data.task.branch} />}
          {data.task.pr && <LinkOrText value={data.task.pr} />}
        </div>
      </SheetHeader>
      <Tabs defaultValue="overview" className="px-4 pb-4">
        <TabsList className="w-full flex-wrap group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="spec">Spec</TabsTrigger>
          <TabsTrigger value="architecture">Architecture</TabsTrigger>
          <TabsTrigger value="slices">Slices</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <Overview data={data} />
        </TabsContent>
        <TabsContent value="spec" className="pt-4">
          <DocView doc={data.spec} taskId={data.task.id} empty="No spec yet" />
        </TabsContent>
        <TabsContent value="architecture" className="pt-4">
          <DocView doc={data.architecture} taskId={data.task.id} empty="No architecture yet" />
        </TabsContent>
        <TabsContent value="slices" className="pt-4">
          <SliceList slices={data.slices} />
        </TabsContent>
        <TabsContent value="notes" className="pt-4">
          <NoteList notes={data.notes} taskId={data.task.id} />
        </TabsContent>
        <TabsContent value="verification" className="pt-4">
          <DocView
            doc={verification}
            taskId={data.task.id}
            empty="No verification yet"
            header={<Badge variant="outline">{verification?.result ?? "pending"}</Badge>}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function LinkOrText({ value }: { value: string }) {
  if (!value.startsWith("http")) return <span>{value}</span>;
  return (
    <a href={value} target="_blank" rel="noreferrer" className="underline">
      {value}
    </a>
  );
}

function Overview({ data }: { data: TaskDetail }) {
  const { task, next } = data;
  return (
    <div className="space-y-4">
      <Markdown taskId={task.id}>{task.description}</Markdown>
      {task.criteria.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-medium">Criteria</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {task.criteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-1 text-sm font-medium">Next</h3>
        <p className="text-sm">
          <span className="font-mono">{next.action}</span> — {next.reason}
        </p>
      </section>
      {next.blocked?.length ? (
        <section>
          <h3 className="mb-1 text-sm font-medium">Blocked</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {next.blocked.map((slice) => (
              <li key={slice.n}>
                #{slice.n} {slice.title}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function DocView({
  doc,
  taskId,
  empty,
  header,
}: {
  doc: Doc;
  taskId: string;
  empty: string;
  header?: ReactNode;
}) {
  if (!doc) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-3">
      {header ??
        (doc.kind !== "verification" && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{doc.status}</Badge>
            <Badge variant="outline">revision {doc.revision}</Badge>
          </div>
        ))}
      <Markdown taskId={taskId}>{doc.body}</Markdown>
    </div>
  );
}

function SliceList({ slices }: { slices: Slice[] }) {
  if (slices.length === 0) return <p className="text-sm text-muted-foreground">No slices yet</p>;
  return (
    <div className="space-y-4">
      {slices.map((slice) => (
        <div key={slice.n} className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">#{slice.n}</span>
            <span className="text-sm font-medium">{slice.title}</span>
            <Badge variant="secondary">{slice.status}</Badge>
            {slice.commit && (
              <span className="font-mono text-xs text-muted-foreground">{slice.commit}</span>
            )}
          </div>
          <p className="text-sm">{slice.goal}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {slice.criteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function NoteList({ notes, taskId }: { notes: Note[]; taskId: string }) {
  if (notes.length === 0) return <p className="text-sm text-muted-foreground">No notes yet</p>;
  return (
    <div className="space-y-4">
      {notes.map((note, i) => (
        <div key={i} className="space-y-1">
          <p className="text-sm">
            {[note.author, note.target, note.verdict].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-muted-foreground">{new Date(note.at).toLocaleString()}</p>
          <Markdown taskId={taskId}>{note.body}</Markdown>
        </div>
      ))}
    </div>
  );
}

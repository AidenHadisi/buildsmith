import { skipToken, useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { api, type TaskDetail } from "../api.ts";
import { ErrorPanel } from "./ErrorPanel.tsx";
import { Markdown } from "./Markdown.tsx";
import { StageBadge } from "./StageBadge.tsx";
import { useTaskParam } from "../hooks/useTaskParam.ts";

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
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl data-[side=right]:lg:w-[max(42rem,40vw)] data-[side=right]:lg:max-w-[max(42rem,40vw)]"
      >
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>{data?.task.title ?? "Task"}</SheetTitle>
            {data && <StageBadge stage={data.next.stage} />}
          </div>
          {data && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-mono">{data.task.id.slice(-6)}</span>
              {data.task.branch && <LinkOrText value={data.task.branch} />}
              {data.task.pr && <LinkOrText value={data.task.pr} />}
            </div>
          )}
        </SheetHeader>
        {data ? (
          <SheetBody data={data} />
        ) : error ? (
          <div className="px-4">
            <ErrorPanel error={error} />
          </div>
        ) : (
          <div className="space-y-2 px-4">
            <div className="h-4 w-1/3 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded-md bg-muted" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ data }: { data: TaskDetail }) {
  const { next, spec, architecture, slices, verification } = data;
  const sliceDone = slices.filter((slice) => slice.status === "done").length;
  const slicing = next.stage === "slicing" || next.stage === "building";
  return (
    <Tabs defaultValue="overview" className="px-4 pb-4">
      <TabsList className="w-full flex-wrap group-data-horizontal/tabs:h-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="spec">
          Spec
          <StepMark
            done={spec?.kind !== "verification" && spec?.status === "approved"}
            current={next.stage === "spec"}
          />
        </TabsTrigger>
        <TabsTrigger value="architecture">
          Architecture
          <StepMark
            done={architecture?.kind !== "verification" && architecture?.status === "approved"}
            current={next.stage === "architecture"}
          />
        </TabsTrigger>
        <TabsTrigger value="slices">
          Slices
          <StepMark
            done={slices.length > 0 && sliceDone === slices.length}
            current={slicing}
            label={slices.length ? `${sliceDone}/${slices.length}` : undefined}
          />
        </TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="verification">
          Verification
          <StepMark
            fail={verification?.kind === "verification" && verification.result === "fail"}
            done={verification?.kind === "verification" && verification.result === "pass"}
            current={next.stage === "verify"}
          />
        </TabsTrigger>
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
        <DocView doc={data.verification} taskId={data.task.id} empty="No verification yet" />
      </TabsContent>
    </Tabs>
  );
}

function StepMark({
  done,
  current,
  fail,
  label,
}: {
  done?: boolean;
  current?: boolean;
  fail?: boolean;
  label?: string;
}) {
  const state = fail ? "fail" : done ? "done" : current ? "current" : "pending";
  return (
    <>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      {stepMarks[state]}
    </>
  );
}

const stepMarks = {
  done: <CheckIcon className="size-3 text-success" />,
  current: <span className="size-1.5 rounded-full bg-warning" />,
  pending: <span className="size-1.5 rounded-full bg-muted-foreground/40" />,
  fail: <span className="size-1.5 rounded-full bg-destructive" />,
};

function LinkOrText({ value }: { value: string }) {
  if (!value.startsWith("http")) return <span>{value}</span>;
  return (
    <a href={value} target="_blank" rel="noreferrer" className="underline">
      {value}
    </a>
  );
}

function Overview({ data: { task, next } }: { data: TaskDetail }) {
  return (
    <div className="space-y-4">
      <Section title="Next">
        <p className="text-sm">
          <span className="font-mono">{next.action}</span> — {next.reason}
        </p>
      </Section>
      {next.blocked?.length ? (
        <Section title="Blocked">
          <Bullets items={next.blocked.map((slice) => `#${slice.n} ${slice.title}`)} />
        </Section>
      ) : null}
      <Markdown taskId={task.id}>{task.description}</Markdown>
      {task.criteria.length > 0 && (
        <Section title="Criteria">
          <Bullets items={task.criteria} />
        </Section>
      )}
    </div>
  );
}

function DocView({ doc, taskId, empty }: { doc: Doc; taskId: string; empty: string }) {
  if (!doc) return <Empty>{empty}</Empty>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {doc.kind === "verification" ? (
          <Badge variant="outline">{doc.result ?? "pending"}</Badge>
        ) : (
          <>
            <Badge variant="secondary">{doc.status}</Badge>
            <Badge variant="outline">revision {doc.revision}</Badge>
          </>
        )}
      </div>
      <Markdown taskId={taskId}>{doc.body}</Markdown>
    </div>
  );
}

function SliceList({ slices }: { slices: Slice[] }) {
  if (slices.length === 0) return <Empty>No slices yet</Empty>;
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
          <Bullets items={slice.criteria} />
        </div>
      ))}
    </div>
  );
}

function NoteList({ notes, taskId }: { notes: Note[]; taskId: string }) {
  if (notes.length === 0) return <Empty>No notes yet</Empty>;
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

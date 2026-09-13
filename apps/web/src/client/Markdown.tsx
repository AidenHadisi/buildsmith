import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ taskId, children }: { taskId: string; children: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          defaultUrlTransform(url.startsWith("assets/") ? `/tasks/${taskId}/${url}` : url)
        }
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({
  taskId,
  className = "",
  children,
}: {
  taskId: string;
  className?: string;
  children: string;
}) {
  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
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

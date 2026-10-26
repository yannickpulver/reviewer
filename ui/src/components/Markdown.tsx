import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface Props {
  children: string;
  className?: string;
  /** Render inline HTML (sanitized) — PR descriptions often use `<img>`, `<details>`. */
  html?: boolean;
  /** Rewrite image sources, e.g. to load host attachments through the server. */
  imageSrc?: (src: string) => string;
  /** Rewrite link targets, e.g. to resolve relative upload links. */
  linkHref?: (href: string) => string;
}

export function Markdown({ children, className, html, imageSrc, linkHref }: Props) {
  const components: Components = {
    img: ({ node: _node, src, ...rest }) => (
      <img {...rest} src={src && imageSrc ? imageSrc(String(src)) : src} loading="lazy" />
    ),
    ...(linkHref && {
      a: ({ node: _node, href, ...rest }) => (
        <a {...rest} href={href ? linkHref(href) : href} target="_blank" rel="noreferrer" />
      ),
    }),
  };
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={html ? [rehypeRaw, rehypeSanitize] : []}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

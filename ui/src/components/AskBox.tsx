import { useState } from "react";
import { Loader2 } from "lucide-react";
import { askClaude } from "@/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "./Markdown";

interface Props {
  path: string;
  line: number;
  code: string;
  onClose: () => void;
}

export function AskBox({ path, line, code, onClose }: Props) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await askClaude(path, line, code, q);
      setAnswer(res.answer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2 p-3 font-sans">
      <Textarea
        autoFocus
        value={question}
        placeholder="Ask Claude about this line…"
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask();
          if (e.key === "Escape") onClose();
        }}
        className="font-sans"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!question.trim() || loading} onClick={ask}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          Ask
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">⌘↵ to ask</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {answer && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <Markdown>{answer}</Markdown>
        </div>
      )}
    </div>
  );
}

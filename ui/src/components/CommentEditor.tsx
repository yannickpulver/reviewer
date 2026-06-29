import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  initial?: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}

export function CommentEditor({ initial = "", onSave, onCancel }: Props) {
  const [value, setValue] = useState(initial);

  return (
    <div className="space-y-2 p-3">
      <Textarea
        autoFocus
        value={value}
        placeholder="Leave a comment…"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && value.trim()) onSave(value.trim());
          if (e.key === "Escape") onCancel();
        }}
        className="font-sans"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!value.trim()} onClick={() => onSave(value.trim())}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">⌘↵ to save</span>
      </div>
    </div>
  );
}

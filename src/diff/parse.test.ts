import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "./parse.js";
import { makeHunkRef, parseHunkRef } from "./types.js";

const SAMPLE = `diff --git a/src/auth.ts b/src/auth.ts
index 1111111..2222222 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,4 +1,5 @@
 import jwt from "jwt";
-const x = 1;
+const x = 2;
+const y = 3;
 export {};
@@ -10,2 +11,2 @@ function foo() {
-  return a;
+  return b;
 }
`;

describe("parseUnifiedDiff", () => {
  it("parses a single modified file with two hunks", () => {
    const { files } = parseUnifiedDiff(SAMPLE);
    expect(files).toHaveLength(1);
    const f = files[0]!;
    expect(f.path).toBe("src/auth.ts");
    expect(f.oldPath).toBe("src/auth.ts");
    expect(f.status).toBe("modified");
    expect(f.binary).toBe(false);
    expect(f.hunks).toHaveLength(2);
    expect(f.hunks[0]!.id).toBe("H0");
    expect(f.hunks[1]!.id).toBe("H1");
  });

  it("computes hunk header ranges", () => {
    const { files } = parseUnifiedDiff(SAMPLE);
    const h0 = files[0]!.hunks[0]!;
    expect(h0.oldStart).toBe(1);
    expect(h0.oldLines).toBe(4);
    expect(h0.newStart).toBe(1);
    expect(h0.newLines).toBe(5);
  });

  it("classifies and numbers lines", () => {
    const { files } = parseUnifiedDiff(SAMPLE);
    const lines = files[0]!.hunks[0]!.lines;
    // import jwt (context), -const x=1, +const x=2, +const y=3, export{} (context)
    expect(lines.map((l) => l.type)).toEqual(["context", "del", "add", "add", "context"]);

    const ctx = lines[0]!;
    expect(ctx.oldLineNo).toBe(1);
    expect(ctx.newLineNo).toBe(1);

    const del = lines[1]!;
    expect(del.oldLineNo).toBe(2);
    expect(del.newLineNo).toBeNull();

    const add = lines[2]!;
    expect(add.oldLineNo).toBeNull();
    expect(add.newLineNo).toBe(2);

    const last = lines[4]!;
    expect(last.oldLineNo).toBe(3);
    expect(last.newLineNo).toBe(4);
  });

  it("detects added files", () => {
    const d = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`;
    const f = parseUnifiedDiff(d).files[0]!;
    expect(f.status).toBe("added");
    expect(f.path).toBe("new.txt");
  });

  it("detects deleted files", () => {
    const d = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index 3333333..0000000
--- a/old.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
`;
    const f = parseUnifiedDiff(d).files[0]!;
    expect(f.status).toBe("deleted");
    expect(f.path).toBe("old.txt");
  });

  it("detects renamed files", () => {
    const d = `diff --git a/a.txt b/b.txt
similarity index 100%
rename from a.txt
rename to b.txt
`;
    const f = parseUnifiedDiff(d).files[0]!;
    expect(f.status).toBe("renamed");
    expect(f.oldPath).toBe("a.txt");
    expect(f.path).toBe("b.txt");
  });

  it("detects binary files", () => {
    const d = `diff --git a/img.png b/img.png
index 1111111..2222222 100644
Binary files a/img.png and b/img.png differ
`;
    const f = parseUnifiedDiff(d).files[0]!;
    expect(f.binary).toBe(true);
    expect(f.hunks).toHaveLength(0);
  });

  it("parses multiple files", () => {
    const d = SAMPLE + `diff --git a/b.ts b/b.ts
index 4444444..5555555 100644
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,1 @@
-old
+new
`;
    const { files } = parseUnifiedDiff(d);
    expect(files.map((f) => f.path)).toEqual(["src/auth.ts", "b.ts"]);
  });
});

describe("hunk refs", () => {
  it("round-trips", () => {
    const ref = makeHunkRef("src/auth.ts", "H1");
    expect(ref).toBe("src/auth.ts:H1");
    expect(parseHunkRef(ref)).toEqual({ path: "src/auth.ts", hunkId: "H1" });
  });

  it("handles paths without colons and rejects garbage", () => {
    expect(parseHunkRef("nope")).toBeNull();
    expect(parseHunkRef(":H1")).toBeNull();
    expect(parseHunkRef("file:")).toBeNull();
  });
});

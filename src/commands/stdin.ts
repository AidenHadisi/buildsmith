export async function piped(): Promise<string> {
  return process.stdin.isTTY ? "" : Bun.stdin.text();
}

export async function body(): Promise<string> {
  const text = await piped();
  if (!text) throw new Error("empty body: pipe it on stdin");
  return text;
}

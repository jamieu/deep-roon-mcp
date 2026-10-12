// The log goes to stderr: stdout is the MCP channel. Claude Desktop keeps stderr in its MCP log.
export function log(...parts: unknown[]): void {
  const d = new Date(), t = (x: number) => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${t(d.getMonth() + 1)}-${t(d.getDate())} ${t(d.getHours())}:${t(d.getMinutes())}:${t(d.getSeconds())}`;
  process.stderr.write(`${stamp} deep-roon-mcp: ${parts.map(String).join(' ')}\n`);
}

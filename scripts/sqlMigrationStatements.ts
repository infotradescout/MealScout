export function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  while (i < sqlText.length) {
    const ch = sqlText[i];
    const next = i + 1 < sqlText.length ? sqlText[i + 1] : "";

    if (!inSingle && !inDouble && !inBlockComment && !dollarTag) {
      if (!inLineComment && ch === "-" && next === "-") {
        inLineComment = true;
        current += ch + next;
        i += 2;
        continue;
      }
      if (inLineComment) {
        current += ch;
        i += 1;
        if (ch === "\n") inLineComment = false;
        continue;
      }
    }

    if (!inSingle && !inDouble && !inLineComment && !dollarTag) {
      if (!inBlockComment && ch === "/" && next === "*") {
        inBlockComment = true;
        current += ch + next;
        i += 2;
        continue;
      }
      if (inBlockComment) {
        current += ch;
        i += 1;
        if (ch === "*" && next === "/") {
          current += next;
          i += 1;
          inBlockComment = false;
        }
        continue;
      }
    }

    if (!inSingle && !inDouble && !inLineComment && !inBlockComment) {
      if (!dollarTag && ch === "$") {
        const rest = sqlText.slice(i);
        const open = rest.match(/^\$[A-Za-z0-9_]*\$/);
        if (open) {
          dollarTag = open[0];
          current += dollarTag;
          i += dollarTag.length;
          continue;
        }
      } else if (dollarTag && sqlText.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
    }

    if (
      !inDouble &&
      !inLineComment &&
      !inBlockComment &&
      !dollarTag &&
      ch === "'"
    ) {
      inSingle = !inSingle;
      current += ch;
      i += 1;
      continue;
    }
    if (
      !inSingle &&
      !inLineComment &&
      !inBlockComment &&
      !dollarTag &&
      ch === '"'
    ) {
      inDouble = !inDouble;
      current += ch;
      i += 1;
      continue;
    }

    if (
      !inSingle &&
      !inDouble &&
      !inLineComment &&
      !inBlockComment &&
      !dollarTag &&
      ch === ";"
    ) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

export interface XNode {
  name: string;
  attrs: Map<string, string>;
  children: (XNode | string)[];
}

function localName(n: string): string {
  const k = n.indexOf(":");
  return k < 0 ? n : n.slice(k + 1);
}

export function decodeEntities(s: string): string {
  const d = s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, g: string) => {
    if (g === "lt") return "<";
    if (g === "gt") return ">";
    if (g === "amp") return "&";
    if (g === "quot") return '"';
    if (g === "apos") return "'";
    const cp = g.charAt(1) === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    if (!Number.isFinite(cp) || cp > 0x10ffff) return m;
    return String.fromCodePoint(cp);
  });
  return d.replace(/_x([0-9a-fA-F]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function parseAttrs(s: string): Map<string, string> {
  const m = new Map<string, string>();
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let r = re.exec(s); r !== null; r = re.exec(s)) {
    m.set(localName(r[1] ?? ""), decodeEntities(r[2] ?? r[3] ?? ""));
  }
  return m;
}

export function parseXml(text: string): XNode {
  const root: XNode = { name: "#root", attrs: new Map(), children: [] };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!(?:[^>"']|"[^"]*"|'[^']*')*>|<(\/?)([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  const top = (): XNode => stack[stack.length - 1] ?? root;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) top().children.push(decodeEntities(text.slice(last, m.index)));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      top().children.push(m[1]);
    } else if (m[3] !== undefined) {
      const name = localName(m[3]);
      if (m[2] === "/") {
        if (stack.length > 1) stack.pop();
      } else {
        const rest = m[4] ?? "";
        const node: XNode = { name, attrs: parseAttrs(rest), children: [] };
        top().children.push(node);
        if (!rest.endsWith("/")) stack.push(node);
      }
    }
  }
  return root;
}

export function elems(n: XNode, name?: string): XNode[] {
  const out: XNode[] = [];
  for (const c of n.children) {
    if (typeof c !== "string" && (name === undefined || c.name === name)) out.push(c);
  }
  return out;
}

export function firstElem(n: XNode, name: string): XNode | undefined {
  return elems(n, name)[0];
}

export function textOf(n: XNode): string {
  let s = "";
  for (const c of n.children) s += typeof c === "string" ? c : textOf(c);
  return s;
}

export type XNode = {
  name: string;
  attrs: Map<string, string>;
  children: XNode[];
  text: string;
};

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function decode(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return ENTITIES.get(body) ?? whole;
  });
}

function localName(n: string): string {
  const k = n.indexOf(":");
  return k < 0 ? n : n.slice(k + 1);
}

export function parseXml(src: string): XNode {
  const root: XNode = { name: "#root", attrs: new Map(), children: [], text: "" };
  const stack: XNode[] = [root];
  const top = (): XNode => stack[stack.length - 1] ?? root;
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      top().text += decode(src.slice(i));
      break;
    }
    if (lt > i) top().text += decode(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt + 4);
      if (e < 0) throw new Error("bad xml");
      i = e + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt + 9);
      if (e < 0) throw new Error("bad xml");
      top().text += src.slice(lt + 9, e);
      i = e + 3;
    } else if (src.startsWith("<?", lt)) {
      const e = src.indexOf("?>", lt + 2);
      if (e < 0) throw new Error("bad xml");
      i = e + 2;
    } else if (src.startsWith("<!", lt)) {
      const e = src.indexOf(">", lt + 2);
      if (e < 0) throw new Error("bad xml");
      i = e + 1;
    } else if (src.startsWith("</", lt)) {
      const e = src.indexOf(">", lt + 2);
      if (e < 0 || stack.length < 2) throw new Error("bad xml");
      stack.pop();
      i = e + 1;
    } else {
      let j = lt + 1;
      let quote = "";
      while (j < n) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      if (j >= n) throw new Error("bad xml");
      let body = src.slice(lt + 1, j);
      const selfClose = body.endsWith("/");
      if (selfClose) body = body.slice(0, -1);
      const nm = /^[^\s/>]+/.exec(body);
      if (!nm) throw new Error("bad xml");
      const attrs = new Map<string, string>();
      const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      for (const m of body.slice(nm[0].length).matchAll(re)) {
        attrs.set(m[1] ?? "", decode(m[2] ?? m[3] ?? ""));
      }
      const node: XNode = { name: localName(nm[0]), attrs, children: [], text: "" };
      top().children.push(node);
      if (!selfClose) stack.push(node);
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new Error("bad xml");
  return root;
}

export function child(node: XNode, name: string): XNode | undefined {
  return node.children.find((c) => c.name === name);
}

export function children(node: XNode, name: string): XNode[] {
  return node.children.filter((c) => c.name === name);
}

// 安全的小表达式求值器：给自由动画里的函数曲线用（模型写表达式，这里解析，绝不 eval）。
// 支持：数字、变量（x 和模型给的参数）、+ - * / ^、括号、一元负号、常量 pi、
// 函数 exp log sqrt abs sin cos tanh sig(sigmoid) min max pow。
// 渲染（TSX）和校验（Node）共用同一份。

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

const FUNCS: Record<string, (...a: number[]) => number> = {
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tanh: Math.tanh,
  sig: (x: number) => 1 / (1 + Math.exp(-x)),
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
export const EXPR_FUNCS = Object.keys(FUNCS);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`数字写错：${src.slice(i, j)}`);
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^(),".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`表达式里有不认识的字符「${c}」`);
  }
  return out;
}

type Node =
  | { k: "num"; v: number }
  | { k: "var"; v: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; f: string; args: Node[] };

/** 解析成语法树。不合法就抛错（错误信息是中文，直接给模型看） */
export function parseExpr(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p++];
    if (!t || (v && !(t.t === "op" && t.v === v))) throw new Error(`表达式「${src}」括号或符号不完整`);
    return t;
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new Error(`表达式「${src}」没写完`);
    if (t.t === "num") { p++; return { k: "num", v: t.v }; }
    if (t.t === "id") {
      p++;
      if (peek()?.t === "op" && (peek() as any).v === "(") {
        eat("(");
        const args: Node[] = [];
        if (!(peek()?.t === "op" && (peek() as any).v === ")")) {
          args.push(sum());
          while (peek()?.t === "op" && (peek() as any).v === ",") { eat(","); args.push(sum()); }
        }
        eat(")");
        if (!Object.prototype.hasOwnProperty.call(FUNCS, t.v)) throw new Error(`函数「${t.v}」不能用，可用：${EXPR_FUNCS.join("、")}`);
        return { k: "call", f: t.v, args };
      }
      return { k: "var", v: t.v };
    }
    if (t.t === "op" && t.v === "(") { eat("("); const n = sum(); eat(")"); return n; }
    if (t.t === "op" && t.v === "-") { p++; return { k: "neg", a: power() }; }
    throw new Error(`表达式「${src}」里「${(t as any).v}」位置不对`);
  };
  const power = (): Node => {
    const base = primary();
    if (peek()?.t === "op" && (peek() as any).v === "^") { eat("^"); return { k: "bin", op: "^", a: base, b: power() }; }
    return base;
  };
  const prod = (): Node => {
    let n = power();
    while (peek()?.t === "op" && "*/".includes((peek() as any).v)) { const op = (eat() as any).v; n = { k: "bin", op, a: n, b: power() }; }
    return n;
  };
  const sum = (): Node => {
    let n = prod();
    while (peek()?.t === "op" && "+-".includes((peek() as any).v)) { const op = (eat() as any).v; n = { k: "bin", op, a: n, b: prod() }; }
    return n;
  };
  const ast = sum();
  if (p < toks.length) throw new Error(`表达式「${src}」后面多了内容`);
  return ast;
}

/** 表达式里用到的变量名（不含函数名和 pi） */
export function exprVars(n: Node, acc = new Set<string>()): Set<string> {
  if (n.k === "var") { if (n.v !== "pi") acc.add(n.v); }
  else if (n.k === "neg") exprVars(n.a, acc);
  else if (n.k === "bin") { exprVars(n.a, acc); exprVars(n.b, acc); }
  else if (n.k === "call") n.args.forEach((a) => exprVars(a, acc));
  return acc;
}

export function evalNode(n: Node, env: Record<string, number>): number {
  switch (n.k) {
    case "num": return n.v;
    case "var": return n.v === "pi" ? Math.PI : Object.prototype.hasOwnProperty.call(env, n.v) ? env[n.v] : 0;
    case "neg": return -evalNode(n.a, env);
    case "bin": {
      const a = evalNode(n.a, env), b = evalNode(n.b, env);
      return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : n.op === "/" ? a / b : Math.pow(a, b);
    }
    case "call": return Object.prototype.hasOwnProperty.call(FUNCS, n.f) ? FUNCS[n.f](...n.args.map((a) => evalNode(a, env))) : 0;
  }
}

/** 编译一次，反复求值（渲染里每帧每个采样点都要算） */
export function compileExpr(src: string): (env: Record<string, number>) => number {
  const ast = parseExpr(src);
  return (env) => {
    const v = evalNode(ast, env);
    return Number.isFinite(v) ? v : 0;
  };
}
